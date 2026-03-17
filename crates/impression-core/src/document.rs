use serde::{Deserialize, Serialize};

/// Default resolution in pixels per inch.
pub const DEFAULT_PPI: u32 = 72;

/// Metadata for a painting document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentMeta {
    /// Unique document identifier (UUID v4 string).
    pub id: String,
    /// User-visible document name.
    pub name: String,
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// Pixels per inch (print resolution).
    pub ppi: u32,
    /// Creation timestamp (Unix milliseconds).
    pub created_at: u64,
    /// Last modified timestamp (Unix milliseconds).
    pub modified_at: u64,
}

impl DocumentMeta {
    /// Create a new document with a generated UUID and the given dimensions.
    pub fn new(name: String, width: u32, height: u32, ppi: u32, now_ms: u64) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            width,
            height,
            ppi,
            created_at: now_ms,
            modified_at: now_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_trip_serialization() {
        let doc = DocumentMeta {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Test Painting".to_string(),
            width: 1920,
            height: 1080,
            ppi: 72,
            created_at: 1710000000000,
            modified_at: 1710000000000,
        };
        let bytes = postcard::to_allocvec(&doc).unwrap();
        let decoded: DocumentMeta = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(doc, decoded);
    }

    #[test]
    fn test_new_generates_valid_uuid() {
        let doc = DocumentMeta::new("Untitled".to_string(), 800, 600, DEFAULT_PPI, 1710000000000);
        let parsed = uuid::Uuid::parse_str(&doc.id).expect("should be valid UUID");
        assert_eq!(parsed.get_version(), Some(uuid::Version::Random));
    }

    #[test]
    fn test_default_ppi() {
        assert_eq!(DEFAULT_PPI, 72);
        let doc = DocumentMeta::new("Test".to_string(), 100, 100, DEFAULT_PPI, 0);
        assert_eq!(doc.ppi, 72);
    }

    #[test]
    fn test_new_sets_timestamps() {
        let now = 1710000000000u64;
        let doc = DocumentMeta::new("Test".to_string(), 100, 100, 72, now);
        assert_eq!(doc.created_at, now);
        assert_eq!(doc.modified_at, now);
    }
}
