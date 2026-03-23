use crate::blend_mode::BlendMode;
use crate::operation::LayerId;

/// Dirty region bounds: (x_min, y_min, x_max, y_max) inclusive.
pub type DirtyBounds = (u32, u32, u32, u32);

/// The kind of adjustment an adjustment layer applies.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AdjustmentKind {
    /// Maps luminance through a gradient lookup.
    /// The gradient_id references a gradient stored in the TypeScript/IndexedDB side.
    GradientMap { gradient_id: String },
}

/// Distinguishes raster (pixel) layers from adjustment layers.
#[derive(Clone, Debug, PartialEq)]
pub enum LayerKind {
    Raster,
    Adjustment(AdjustmentKind),
}

impl Default for LayerKind {
    fn default() -> Self {
        LayerKind::Raster
    }
}

#[derive(Clone, Debug)]
pub struct Layer {
    /// Globally unique identifier. Generated as `(site_id << 32) | counter`.
    /// See docs/multiplayer-design.md.
    pub id: LayerId,
    pub name: String,
    pub kind: LayerKind,
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub dirty: bool,
    pub dirty_bounds: Option<DirtyBounds>,
    pub opacity: f32,
    pub visible: bool,
    pub blend_mode: BlendMode,
}

impl Layer {
    pub fn new(id: LayerId, width: u32, height: u32) -> Self {
        let size = (width * height * 4) as usize;
        Self {
            id,
            name: String::new(),
            kind: LayerKind::Raster,
            pixels: vec![0u8; size],
            width,
            height,
            dirty: false,
            dirty_bounds: None,
            opacity: 1.0,
            visible: true,
            blend_mode: BlendMode::default(),
        }
    }

    /// Create a new adjustment layer. No pixel buffer is allocated.
    pub fn new_adjustment(id: LayerId, width: u32, height: u32, kind: AdjustmentKind) -> Self {
        Self {
            id,
            name: String::new(),
            kind: LayerKind::Adjustment(kind),
            pixels: Vec::new(),
            width,
            height,
            dirty: false,
            dirty_bounds: None,
            opacity: 1.0,
            visible: true,
            blend_mode: BlendMode::default(),
        }
    }

    pub fn is_adjustment(&self) -> bool {
        matches!(self.kind, LayerKind::Adjustment(_))
    }

    pub fn clear(&mut self) {
        self.pixels.fill(0);
        self.mark_fully_dirty();
    }

    /// Mark the entire layer as dirty (for operations like clear or full replay).
    pub fn mark_fully_dirty(&mut self) {
        self.dirty = true;
        self.dirty_bounds = Some((
            0,
            0,
            self.width.saturating_sub(1),
            self.height.saturating_sub(1),
        ));
    }

    /// Expand the dirty region to include the given bounds.
    pub fn expand_dirty(&mut self, bounds: DirtyBounds) {
        if bounds.0 > bounds.2 || bounds.1 > bounds.3 {
            return;
        }
        self.dirty = true;
        self.dirty_bounds = Some(match self.dirty_bounds {
            Some((x0, y0, x1, y1)) => (
                x0.min(bounds.0),
                y0.min(bounds.1),
                x1.max(bounds.2),
                y1.max(bounds.3),
            ),
            None => bounds,
        });
    }

    /// Clear the dirty flag and bounds.
    pub fn clear_dirty(&mut self) {
        self.dirty = false;
        self.dirty_bounds = None;
    }

    /// Get mutable reference to pixel at (x, y) as [R, G, B, A].
    pub fn pixel_mut(&mut self, x: u32, y: u32) -> Option<&mut [u8; 4]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let idx = ((y * self.width + x) * 4) as usize;
        Some((&mut self.pixels[idx..idx + 4]).try_into().unwrap())
    }

    /// Compute a fast fingerprint of the pixel data for change detection.
    /// Uses FNV-1a hash which is fast for byte sequences.
    pub fn pixel_fingerprint(&self) -> u64 {
        let mut hash: u64 = 0xcbf29ce484222325;
        for &byte in &self.pixels {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    /// Get pixel at (x, y) as [R, G, B, A].
    pub fn pixel(&self, x: u32, y: u32) -> Option<[u8; 4]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let idx = ((y * self.width + x) * 4) as usize;
        let mut p = [0u8; 4];
        p.copy_from_slice(&self.pixels[idx..idx + 4]);
        Some(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_layer_is_transparent() {
        let layer = Layer::new(0, 10, 10);
        assert_eq!(layer.pixels.len(), 400);
        assert!(layer.pixels.iter().all(|&b| b == 0));
        assert!(!layer.dirty);
    }

    #[test]
    fn test_clear_sets_dirty() {
        let mut layer = Layer::new(0, 4, 4);
        layer.pixels[0] = 255;
        layer.clear();
        assert!(layer.dirty);
        assert!(layer.pixels.iter().all(|&b| b == 0));
    }

    #[test]
    fn test_pixel_access() {
        let mut layer = Layer::new(0, 4, 4);
        {
            let px = layer.pixel_mut(1, 2).unwrap();
            px[0] = 255;
            px[3] = 128;
        }
        let px = layer.pixel(1, 2).unwrap();
        assert_eq!(px, [255, 0, 0, 128]);
    }

    #[test]
    fn test_out_of_bounds() {
        let layer = Layer::new(0, 4, 4);
        assert!(layer.pixel(4, 0).is_none());
        assert!(layer.pixel(0, 4).is_none());
    }

    #[test]
    fn test_default_blend_mode() {
        let layer = Layer::new(0, 4, 4);
        assert_eq!(layer.blend_mode, BlendMode::Normal);
    }

    #[test]
    fn test_set_blend_mode() {
        let mut layer = Layer::new(0, 4, 4);
        layer.blend_mode = BlendMode::ColorBurn;
        assert_eq!(layer.blend_mode, BlendMode::ColorBurn);
    }

    #[test]
    fn test_expand_dirty() {
        let mut layer = Layer::new(0, 100, 100);
        assert!(layer.dirty_bounds.is_none());

        layer.expand_dirty((10, 20, 30, 40));
        assert!(layer.dirty);
        assert_eq!(layer.dirty_bounds, Some((10, 20, 30, 40)));

        layer.expand_dirty((5, 25, 35, 35));
        assert_eq!(layer.dirty_bounds, Some((5, 20, 35, 40)));
    }

    #[test]
    fn test_clear_dirty() {
        let mut layer = Layer::new(0, 100, 100);
        layer.expand_dirty((10, 20, 30, 40));
        layer.clear_dirty();
        assert!(!layer.dirty);
        assert!(layer.dirty_bounds.is_none());
    }

    #[test]
    fn test_pixel_fingerprint_changes_with_content() {
        let mut layer = Layer::new(0, 10, 10);
        let fp1 = layer.pixel_fingerprint();

        layer.pixels[0] = 255;
        let fp2 = layer.pixel_fingerprint();

        assert_ne!(fp1, fp2, "Fingerprint should change when pixels change");
    }

    #[test]
    fn test_pixel_fingerprint_identical_for_same_content() {
        let layer1 = Layer::new(0, 10, 10);
        let layer2 = Layer::new(0, 10, 10);
        assert_eq!(layer1.pixel_fingerprint(), layer2.pixel_fingerprint());
    }

    #[test]
    fn test_mark_fully_dirty() {
        let mut layer = Layer::new(0, 100, 50);
        layer.mark_fully_dirty();
        assert!(layer.dirty);
        assert_eq!(layer.dirty_bounds, Some((0, 0, 99, 49)));
    }
}
