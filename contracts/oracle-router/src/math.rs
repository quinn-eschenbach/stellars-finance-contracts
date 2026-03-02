/// In-place insertion sort for a soroban_sdk::Vec<i128> (ascending order).
pub fn insertion_sort(prices: &mut soroban_sdk::Vec<i128>) {
    let n = prices.len();
    for i in 1..n {
        let key = prices.get(i).unwrap();
        let mut j = i;
        while j > 0 {
            let prev = prices.get(j - 1).unwrap();
            if prev <= key {
                break;
            }
            prices.set(j, prev);
            j -= 1;
        }
        prices.set(j, key);
    }
}

/// Return the lower-median index for a sorted slice of length `n`.
/// For odd `n`, returns the middle index; for even `n`, returns `n/2 - 1`.
/// Assumes `n > 0`.
pub fn median_idx(n: u32) -> u32 {
    if n % 2 == 1 {
        n / 2
    } else {
        n / 2 - 1
    }
}

/// Compute max one-sided deviation in basis points.
///   deviation_bps = max(max − median, median − min) × 10_000 / median
pub fn deviation_bps(median: i128, min: i128, max: i128) -> i128 {
    let upper = (max - median) * 10_000 / median;
    let lower = (median - min) * 10_000 / median;
    if upper > lower { upper } else { lower }
}
