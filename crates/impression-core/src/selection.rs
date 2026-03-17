use serde::{Deserialize, Serialize};

/// Combine mode for selection operations.
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
#[repr(u8)]
pub enum CombineMode {
    #[default]
    Replace = 0,
    Add = 1,
    Subtract = 2,
    Intersect = 3,
}

impl CombineMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => CombineMode::Add,
            2 => CombineMode::Subtract,
            3 => CombineMode::Intersect,
            _ => CombineMode::Replace,
        }
    }
}

/// A canvas-wide selection mask. Each pixel is 0 (not selected) to 255 (fully selected).
#[derive(Clone, Debug)]
pub struct SelectionMask {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub dirty: bool,
}

impl SelectionMask {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            data: vec![0u8; (width * height) as usize],
            width,
            height,
            dirty: true,
        }
    }

    pub fn new_full(width: u32, height: u32) -> Self {
        Self {
            data: vec![255u8; (width * height) as usize],
            width,
            height,
            dirty: true,
        }
    }

    /// Get the selection value at (x, y).
    pub fn get(&self, x: u32, y: u32) -> u8 {
        if x >= self.width || y >= self.height {
            return 0;
        }
        self.data[(y * self.width + x) as usize]
    }

    /// Set the selection value at (x, y).
    pub fn set(&mut self, x: u32, y: u32, value: u8) {
        if x < self.width && y < self.height {
            self.data[(y * self.width + x) as usize] = value;
        }
    }

    /// Fill the entire mask with 255 (select all).
    pub fn select_all(&mut self) {
        self.data.fill(255);
        self.dirty = true;
    }

    /// Fill a rectangle into the mask with the given combine mode.
    pub fn fill_rect(&mut self, x: u32, y: u32, w: u32, h: u32, mode: CombineMode) {
        // Build temporary rect mask
        let mut temp = vec![0u8; self.data.len()];
        let x_end = (x + w).min(self.width);
        let y_end = (y + h).min(self.height);
        for py in y..y_end {
            for px in x..x_end {
                temp[(py * self.width + px) as usize] = 255;
            }
        }
        self.combine(&temp, mode);
        self.dirty = true;
    }

    /// Rasterize a polygon (from lasso points) into the mask using scanline fill.
    pub fn fill_polygon(&mut self, points: &[(f32, f32)], mode: CombineMode) {
        if points.len() < 3 {
            return;
        }

        let mut temp = vec![0u8; self.data.len()];

        // Find bounding box
        let mut y_min_f = f32::MAX;
        let mut y_max_f = f32::MIN;
        for &(_, y) in points {
            y_min_f = y_min_f.min(y);
            y_max_f = y_max_f.max(y);
        }
        let y_min = (y_min_f.floor().max(0.0)) as u32;
        let y_max = (y_max_f.ceil()).min(self.height as f32 - 1.0) as u32;

        // Scanline fill
        for scan_y in y_min..=y_max {
            let y_f = scan_y as f32 + 0.5;
            let mut intersections = Vec::new();

            let n = points.len();
            for i in 0..n {
                let (x0, y0) = points[i];
                let (x1, y1) = points[(i + 1) % n];

                // Skip horizontal edges
                if (y1 - y0).abs() < 0.001 {
                    continue;
                }

                // Check if scanline intersects this edge
                let (ylo, yhi) = if y0 < y1 { (y0, y1) } else { (y1, y0) };
                if y_f < ylo || y_f >= yhi {
                    continue;
                }

                let t = (y_f - y0) / (y1 - y0);
                let x_intersect = x0 + t * (x1 - x0);
                intersections.push(x_intersect);
            }

            intersections.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

            // Fill between pairs
            let mut i = 0;
            while i + 1 < intersections.len() {
                let x_start = (intersections[i].ceil().max(0.0)) as u32;
                let x_end = (intersections[i + 1].floor().min(self.width as f32 - 1.0)) as u32;
                for px in x_start..=x_end {
                    temp[(scan_y * self.width + px) as usize] = 255;
                }
                i += 2;
            }
        }

        self.combine(&temp, mode);
        self.dirty = true;
    }

    /// Combine a new mask into this mask using the given mode.
    fn combine(&mut self, new_mask: &[u8], mode: CombineMode) {
        match mode {
            CombineMode::Replace => {
                self.data.copy_from_slice(new_mask);
            }
            CombineMode::Add => {
                for (dst, &src) in self.data.iter_mut().zip(new_mask.iter()) {
                    *dst = dst.saturating_add(src);
                }
            }
            CombineMode::Subtract => {
                for (dst, &src) in self.data.iter_mut().zip(new_mask.iter()) {
                    *dst = dst.saturating_sub(src);
                }
            }
            CombineMode::Intersect => {
                for (dst, &src) in self.data.iter_mut().zip(new_mask.iter()) {
                    *dst = (*dst).min(src);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_mask_is_empty() {
        let mask = SelectionMask::new(10, 10);
        assert!(mask.data.iter().all(|&v| v == 0));
    }

    #[test]
    fn test_new_full_mask() {
        let mask = SelectionMask::new_full(10, 10);
        assert!(mask.data.iter().all(|&v| v == 255));
    }

    #[test]
    fn test_select_all() {
        let mut mask = SelectionMask::new(10, 10);
        mask.select_all();
        assert!(mask.data.iter().all(|&v| v == 255));
        assert!(mask.dirty);
    }

    #[test]
    fn test_fill_rect_replace() {
        let mut mask = SelectionMask::new(10, 10);
        mask.fill_rect(2, 3, 4, 5, CombineMode::Replace);

        assert_eq!(mask.get(2, 3), 255);
        assert_eq!(mask.get(5, 7), 255);
        assert_eq!(mask.get(0, 0), 0);
        assert_eq!(mask.get(6, 3), 0); // x=6 is outside (2+4=6, exclusive)
    }

    #[test]
    fn test_fill_rect_add() {
        let mut mask = SelectionMask::new(10, 10);
        mask.fill_rect(0, 0, 5, 5, CombineMode::Replace);
        mask.fill_rect(3, 3, 5, 5, CombineMode::Add);

        // Original area should still be selected
        assert_eq!(mask.get(1, 1), 255);
        // New area should also be selected
        assert_eq!(mask.get(6, 6), 255);
        // Overlap area should be selected
        assert_eq!(mask.get(4, 4), 255);
    }

    #[test]
    fn test_fill_rect_subtract() {
        let mut mask = SelectionMask::new(10, 10);
        mask.select_all();
        mask.fill_rect(2, 2, 3, 3, CombineMode::Subtract);

        assert_eq!(mask.get(0, 0), 255);
        assert_eq!(mask.get(3, 3), 0);
    }

    #[test]
    fn test_fill_rect_intersect() {
        let mut mask = SelectionMask::new(10, 10);
        mask.fill_rect(0, 0, 6, 6, CombineMode::Replace);
        mask.fill_rect(3, 3, 6, 6, CombineMode::Intersect);

        // Only the overlap (3..6, 3..6) should remain
        assert_eq!(mask.get(1, 1), 0); // was in first rect but not second
        assert_eq!(mask.get(7, 7), 0); // was in second rect but not first
        assert_eq!(mask.get(4, 4), 255); // overlap
    }

    #[test]
    fn test_fill_polygon_triangle() {
        let mut mask = SelectionMask::new(20, 20);
        let points = vec![(10.0, 2.0), (18.0, 18.0), (2.0, 18.0)];
        mask.fill_polygon(&points, CombineMode::Replace);

        // Center should be selected
        assert_eq!(mask.get(10, 10), 255);
        // Corner should not be
        assert_eq!(mask.get(0, 0), 0);
    }

    #[test]
    fn test_fill_polygon_too_few_points() {
        let mut mask = SelectionMask::new(10, 10);
        mask.fill_polygon(&[(1.0, 1.0), (5.0, 5.0)], CombineMode::Replace);
        // Should be a no-op
        assert!(mask.data.iter().all(|&v| v == 0));
    }

    #[test]
    fn test_fill_polygon_add_mode() {
        let mut mask = SelectionMask::new(20, 20);
        mask.fill_rect(0, 0, 5, 5, CombineMode::Replace);

        let points = vec![(10.0, 10.0), (18.0, 18.0), (2.0, 18.0)];
        mask.fill_polygon(&points, CombineMode::Add);

        // Both areas selected
        assert_eq!(mask.get(2, 2), 255);
        assert_eq!(mask.get(10, 15), 255);
    }

    #[test]
    fn test_combine_mode_from_u8() {
        assert_eq!(CombineMode::from_u8(0), CombineMode::Replace);
        assert_eq!(CombineMode::from_u8(1), CombineMode::Add);
        assert_eq!(CombineMode::from_u8(2), CombineMode::Subtract);
        assert_eq!(CombineMode::from_u8(3), CombineMode::Intersect);
        assert_eq!(CombineMode::from_u8(99), CombineMode::Replace);
    }
}
