#[derive(Debug)]
pub struct Layer {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub dirty: bool,
    pub opacity: f32,
    pub visible: bool,
    pub blend_mode: u32,
}

impl Layer {
    pub fn new(width: u32, height: u32) -> Self {
        let size = (width * height * 4) as usize;
        Self {
            pixels: vec![0u8; size],
            width,
            height,
            dirty: false,
            opacity: 1.0,
            visible: true,
            blend_mode: 0, // Normal (Source Over)
        }
    }

    pub fn clear(&mut self) {
        self.pixels.fill(0);
        self.dirty = true;
    }

    /// Get mutable reference to pixel at (x, y) as [R, G, B, A].
    pub fn pixel_mut(&mut self, x: u32, y: u32) -> Option<&mut [u8; 4]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let idx = ((y * self.width + x) * 4) as usize;
        Some((&mut self.pixels[idx..idx + 4]).try_into().unwrap())
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
        let layer = Layer::new(10, 10);
        assert_eq!(layer.pixels.len(), 400);
        assert!(layer.pixels.iter().all(|&b| b == 0));
        assert!(!layer.dirty);
    }

    #[test]
    fn test_clear_sets_dirty() {
        let mut layer = Layer::new(4, 4);
        layer.pixels[0] = 255;
        layer.clear();
        assert!(layer.dirty);
        assert!(layer.pixels.iter().all(|&b| b == 0));
    }

    #[test]
    fn test_pixel_access() {
        let mut layer = Layer::new(4, 4);
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
        let layer = Layer::new(4, 4);
        assert!(layer.pixel(4, 0).is_none());
        assert!(layer.pixel(0, 4).is_none());
    }

    #[test]
    fn test_default_blend_mode() {
        let layer = Layer::new(4, 4);
        assert_eq!(layer.blend_mode, 0); // Normal
    }

    #[test]
    fn test_set_blend_mode() {
        let mut layer = Layer::new(4, 4);
        layer.blend_mode = 3;
        assert_eq!(layer.blend_mode, 3);
    }
}
