use std::hash::{Hash, Hasher};

/// Hybrid affinity+overflow routing. Returns the worker slot index
/// (0..N-1) to dispatch the next render to.
///
/// Rules:
///   1. Compute affinity = hash(path, page_index) % N
///   2. If depths[affinity] <= OVERFLOW_THRESHOLD: use affinity
///   3. Otherwise: pick the least-busy slot
///
/// Dead slots (depth == usize::MAX as sentinel) are skipped.
pub const OVERFLOW_THRESHOLD: usize = 2;

pub fn pick_worker(path: &str, page_index: u32, depths: &[usize]) -> usize {
    assert!(!depths.is_empty(), "depths cannot be empty");

    let alive: Vec<usize> = depths.iter().enumerate()
        .filter(|(_, &d)| d != usize::MAX)
        .map(|(i, _)| i)
        .collect();
    assert!(!alive.is_empty(), "no live workers");

    let n_alive = alive.len();
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    page_index.hash(&mut h);
    let affinity_idx = (h.finish() as usize) % n_alive;
    let affinity = alive[affinity_idx];

    if depths[affinity] <= OVERFLOW_THRESHOLD {
        return affinity;
    }

    // Overflow: least-busy among alive
    *alive.iter().min_by_key(|&&i| depths[i]).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn affinity_used_when_depth_under_threshold() {
        let depths = vec![0, 0, 0, 0, 0];
        // Same (path, page) should always pick the same worker
        let a = pick_worker("foo.pdf", 5, &depths);
        let b = pick_worker("foo.pdf", 5, &depths);
        assert_eq!(a, b);
        assert!(a < 5);
    }

    #[test]
    fn different_pages_distribute() {
        let depths = vec![0, 0, 0, 0, 0];
        let mut picks = std::collections::HashSet::new();
        for p in 0..20 {
            picks.insert(pick_worker("foo.pdf", p, &depths));
        }
        // 20 pages across 5 workers should hit at least 3 different slots
        assert!(picks.len() >= 3, "got only {} distinct workers", picks.len());
    }

    #[test]
    fn overflow_falls_back_to_least_busy() {
        // Force affinity = slot 0 (load all into slot 0)
        // We can't easily control hash output, so test the BEHAVIOR:
        // if every slot has depth 3, the affinity target ALSO has depth 3 → overflow.
        // The fallback picks least-busy, which will be the slot with the lowest depth.
        let depths = vec![5, 1, 5, 5, 5];
        for p in 0..10 {
            let picked = pick_worker("foo.pdf", p, &depths);
            // Picked slot must EITHER be the affinity target (if <= 2) OR slot 1 (least busy)
            // Since depths[1] = 1 is the only one <= 2, picked must be 1
            assert_eq!(picked, 1, "page {} picked {}", p, picked);
        }
    }

    #[test]
    fn skips_dead_workers() {
        let depths = vec![usize::MAX, 0, usize::MAX, 0, usize::MAX]; // only 1 and 3 alive
        for p in 0..10 {
            let picked = pick_worker("foo.pdf", p, &depths);
            assert!(picked == 1 || picked == 3, "got {}", picked);
        }
    }

    #[test]
    #[should_panic(expected = "no live workers")]
    fn panics_when_all_dead() {
        let depths = vec![usize::MAX, usize::MAX, usize::MAX];
        pick_worker("foo.pdf", 0, &depths);
    }
}
