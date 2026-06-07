#[repr(align(64))]
#[derive(Clone, Debug)]
pub struct AlignedEmbedding(pub [f32; 768]);

impl AlignedEmbedding {
    pub fn new(values: &[f32]) -> Self {
        let mut arr = [0.0f32; 768];
        let len = values.len().min(768);
        arr[..len].copy_from_slice(&values[..len]);
        AlignedEmbedding(arr)
    }
}

/// Dynamic SIMD L2 squared distance router.
/// Selects the optimal hardware-accelerated code path at runtime.
pub fn l2_distance(
    x: &AlignedEmbedding,
    y: &AlignedEmbedding,
    next_y: Option<&AlignedEmbedding>,
) -> f32 {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512f") {
            unsafe {
                return l2_distance_avx512(x, y, next_y);
            }
        }
        if is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma") {
            unsafe {
                return l2_distance_avx2(x, y, next_y);
            }
        }
    }

    #[cfg(target_arch = "aarch64")]
    {
        unsafe {
            return l2_distance_neon(x, y, next_y);
        }
    }

    l2_distance_scalar(x, y)
}

/// AVX-512 Aligned & 8-Way Unrolled FMA L2 squared distance calculation.
/// Processes 128 float elements per loop iteration (16 floats * 8 accumulators).
///
/// # Safety
///
/// This function is unsafe because it uses AVX-512 intrinsics and raw pointer arithmetic.
/// The caller must ensure that the CPU supports the `avx512f` target feature.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f")]
pub unsafe fn l2_distance_avx512(
    x: &AlignedEmbedding,
    y: &AlignedEmbedding,
    next_y: Option<&AlignedEmbedding>,
) -> f32 {
    use std::arch::x86_64::*;

    // Prefetch the next vector in the sequence into the L1 CPU cache
    if let Some(ny) = next_y {
        _mm_prefetch(ny.0.as_ptr() as *const i8, _MM_HINT_T0);
    }

    let mut sum0 = _mm512_setzero_ps();
    let mut sum1 = _mm512_setzero_ps();
    let mut sum2 = _mm512_setzero_ps();
    let mut sum3 = _mm512_setzero_ps();
    let mut sum4 = _mm512_setzero_ps();
    let mut sum5 = _mm512_setzero_ps();
    let mut sum6 = _mm512_setzero_ps();
    let mut sum7 = _mm512_setzero_ps();

    let ptr_x = x.0.as_ptr();
    let ptr_y = y.0.as_ptr();

    let mut i = 0;
    while i < 768 {
        // Aligned loads are guaranteed safe by AlignedEmbedding alignment
        let x0 = _mm512_load_ps(ptr_x.add(i));
        let y0 = _mm512_load_ps(ptr_y.add(i));
        let diff0 = _mm512_sub_ps(x0, y0);
        sum0 = _mm512_fmadd_ps(diff0, diff0, sum0);

        let x1 = _mm512_load_ps(ptr_x.add(i + 16));
        let y1 = _mm512_load_ps(ptr_y.add(i + 16));
        let diff1 = _mm512_sub_ps(x1, y1);
        sum1 = _mm512_fmadd_ps(diff1, diff1, sum1);

        let x2 = _mm512_load_ps(ptr_x.add(i + 32));
        let y2 = _mm512_load_ps(ptr_y.add(i + 32));
        let diff2 = _mm512_sub_ps(x2, y2);
        sum2 = _mm512_fmadd_ps(diff2, diff2, sum2);

        let x3 = _mm512_load_ps(ptr_x.add(i + 48));
        let y3 = _mm512_load_ps(ptr_y.add(i + 48));
        let diff3 = _mm512_sub_ps(x3, y3);
        sum3 = _mm512_fmadd_ps(diff3, diff3, sum3);

        let x4 = _mm512_load_ps(ptr_x.add(i + 64));
        let y4 = _mm512_load_ps(ptr_y.add(i + 64));
        let diff4 = _mm512_sub_ps(x4, y4);
        sum4 = _mm512_fmadd_ps(diff4, diff4, sum4);

        let x5 = _mm512_load_ps(ptr_x.add(i + 80));
        let y5 = _mm512_load_ps(ptr_y.add(i + 80));
        let diff5 = _mm512_sub_ps(x5, y5);
        sum5 = _mm512_fmadd_ps(diff5, diff5, sum5);

        let x6 = _mm512_load_ps(ptr_x.add(i + 96));
        let y6 = _mm512_load_ps(ptr_y.add(i + 96));
        let diff6 = _mm512_sub_ps(x6, y6);
        sum6 = _mm512_fmadd_ps(diff6, diff6, sum6);

        let x7 = _mm512_load_ps(ptr_x.add(i + 112));
        let y7 = _mm512_load_ps(ptr_y.add(i + 112));
        let diff7 = _mm512_sub_ps(x7, y7);
        sum7 = _mm512_fmadd_ps(diff7, diff7, sum7);

        i += 128;
    }

    let s0 = _mm512_add_ps(sum0, sum1);
    let s1 = _mm512_add_ps(sum2, sum3);
    let s2 = _mm512_add_ps(sum4, sum5);
    let s3 = _mm512_add_ps(sum6, sum7);

    let sum = _mm512_add_ps(_mm512_add_ps(s0, s1), _mm512_add_ps(s2, s3));

    // Horizontal addition using memory writeback (guaranteed compiler independent alignment check)
    let mut temp = [0.0f32; 16];
    _mm512_storeu_ps(temp.as_mut_ptr(), sum);
    temp.iter().sum()
}

/// AVX2 Aligned & 8-Way Unrolled FMA L2 squared distance calculation.
/// Processes 64 float elements per loop iteration (8 floats * 8 accumulators).
///
/// # Safety
///
/// This function is unsafe because it uses AVX2 and FMA intrinsics and raw pointer arithmetic.
/// The caller must ensure that the CPU supports the `avx2` and `fma` target features.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2", enable = "fma")]
pub unsafe fn l2_distance_avx2(
    x: &AlignedEmbedding,
    y: &AlignedEmbedding,
    next_y: Option<&AlignedEmbedding>,
) -> f32 {
    use std::arch::x86_64::*;

    // Prefetch the next vector in the sequence into the L1 CPU cache
    if let Some(ny) = next_y {
        _mm_prefetch(ny.0.as_ptr() as *const i8, _MM_HINT_T0);
    }

    let mut sum0 = _mm256_setzero_ps();
    let mut sum1 = _mm256_setzero_ps();
    let mut sum2 = _mm256_setzero_ps();
    let mut sum3 = _mm256_setzero_ps();
    let mut sum4 = _mm256_setzero_ps();
    let mut sum5 = _mm256_setzero_ps();
    let mut sum6 = _mm256_setzero_ps();
    let mut sum7 = _mm256_setzero_ps();

    let ptr_x = x.0.as_ptr();
    let ptr_y = y.0.as_ptr();

    let mut i = 0;
    while i < 768 {
        // Aligned loads are guaranteed safe by AlignedEmbedding alignment
        let x0 = _mm256_load_ps(ptr_x.add(i));
        let y0 = _mm256_load_ps(ptr_y.add(i));
        let diff0 = _mm256_sub_ps(x0, y0);
        sum0 = _mm256_fmadd_ps(diff0, diff0, sum0);

        let x1 = _mm256_load_ps(ptr_x.add(i + 8));
        let y1 = _mm256_load_ps(ptr_y.add(i + 8));
        let diff1 = _mm256_sub_ps(x1, y1);
        sum1 = _mm256_fmadd_ps(diff1, diff1, sum1);

        let x2 = _mm256_load_ps(ptr_x.add(i + 16));
        let y2 = _mm256_load_ps(ptr_y.add(i + 16));
        let diff2 = _mm256_sub_ps(x2, y2);
        sum2 = _mm256_fmadd_ps(diff2, diff2, sum2);

        let x3 = _mm256_load_ps(ptr_x.add(i + 24));
        let y3 = _mm256_load_ps(ptr_y.add(i + 24));
        let diff3 = _mm256_sub_ps(x3, y3);
        sum3 = _mm256_fmadd_ps(diff3, diff3, sum3);

        let x4 = _mm256_load_ps(ptr_x.add(i + 32));
        let y4 = _mm256_load_ps(ptr_y.add(i + 32));
        let diff4 = _mm256_sub_ps(x4, y4);
        sum4 = _mm256_fmadd_ps(diff4, diff4, sum4);

        let x5 = _mm256_load_ps(ptr_x.add(i + 40));
        let y5 = _mm256_load_ps(ptr_y.add(i + 40));
        let diff5 = _mm256_sub_ps(x5, y5);
        sum5 = _mm256_fmadd_ps(diff5, diff5, sum5);

        let x6 = _mm256_load_ps(ptr_x.add(i + 48));
        let y6 = _mm256_load_ps(ptr_y.add(i + 48));
        let diff6 = _mm256_sub_ps(x6, y6);
        sum6 = _mm256_fmadd_ps(diff6, diff6, sum6);

        let x7 = _mm256_load_ps(ptr_x.add(i + 56));
        let y7 = _mm256_load_ps(ptr_y.add(i + 56));
        let diff7 = _mm256_sub_ps(x7, y7);
        sum7 = _mm256_fmadd_ps(diff7, diff7, sum7);

        i += 64;
    }

    let s0 = _mm256_add_ps(sum0, sum1);
    let s1 = _mm256_add_ps(sum2, sum3);
    let s2 = _mm256_add_ps(sum4, sum5);
    let s3 = _mm256_add_ps(sum6, sum7);

    let sum = _mm256_add_ps(_mm256_add_ps(s0, s1), _mm256_add_ps(s2, s3));

    // Horizontal addition using memory writeback (guaranteed compiler independent alignment check)
    let mut temp = [0.0f32; 8];
    _mm256_storeu_ps(temp.as_mut_ptr(), sum);
    temp.iter().sum()
}

/// ARM NEON 8-Way Unrolled FMA L2 squared distance calculation.
/// Processes 32 float elements per loop iteration (4 floats * 8 accumulators).
///
/// # Safety
///
/// This function is unsafe because it uses ARM NEON instructions and raw pointer arithmetic.
/// The caller must ensure that the CPU supports the `neon` target feature and target arch is `aarch64`.
#[cfg(target_arch = "aarch64")]
pub unsafe fn l2_distance_neon(
    x: &AlignedEmbedding,
    y: &AlignedEmbedding,
    next_y: Option<&AlignedEmbedding>,
) -> f32 {
    use std::arch::aarch64::*;

    // Prefetch the next vector in the sequence into the L1 CPU cache
    if let Some(ny) = next_y {
        // PLDL1KEEP = prefetch data load L1 keep
        // 0 = cast to pointer, standard ARM assembly hint
        #[cfg(target_feature = "neon")]
        std::arch::asm!(
            "prfm pldl1keep, [{x}]",
            x = in(reg) ny.0.as_ptr()
        );
    }

    let mut sum0 = vdupq_n_f32(0.0);
    let mut sum1 = vdupq_n_f32(0.0);
    let mut sum2 = vdupq_n_f32(0.0);
    let mut sum3 = vdupq_n_f32(0.0);
    let mut sum4 = vdupq_n_f32(0.0);
    let mut sum5 = vdupq_n_f32(0.0);
    let mut sum6 = vdupq_n_f32(0.0);
    let mut sum7 = vdupq_n_f32(0.0);

    let ptr_x = x.0.as_ptr();
    let ptr_y = y.0.as_ptr();

    let mut i = 0;
    while i < 768 {
        let x0 = vld1q_f32(ptr_x.add(i));
        let y0 = vld1q_f32(ptr_y.add(i));
        let diff0 = vsubq_f32(x0, y0);
        sum0 = vmlaq_f32(sum0, diff0, diff0);

        let x1 = vld1q_f32(ptr_x.add(i + 4));
        let y1 = vld1q_f32(ptr_y.add(i + 4));
        let diff1 = vsubq_f32(x1, y1);
        sum1 = vmlaq_f32(sum1, diff1, diff1);

        let x2 = vld1q_f32(ptr_x.add(i + 8));
        let y2 = vld1q_f32(ptr_y.add(i + 8));
        let diff2 = vsubq_f32(x2, y2);
        sum2 = vmlaq_f32(sum2, diff2, diff2);

        let x3 = vld1q_f32(ptr_x.add(i + 12));
        let y3 = vld1q_f32(ptr_y.add(i + 12));
        let diff3 = vsubq_f32(x3, y3);
        sum3 = vmlaq_f32(sum3, diff3, diff3);

        let x4 = vld1q_f32(ptr_x.add(i + 16));
        let y4 = vld1q_f32(ptr_y.add(i + 16));
        let diff4 = vsubq_f32(x4, y4);
        sum4 = vmlaq_f32(sum4, diff4, diff4);

        let x5 = vld1q_f32(ptr_x.add(i + 20));
        let y5 = vld1q_f32(ptr_y.add(i + 20));
        let diff5 = vsubq_f32(x5, y5);
        sum5 = vmlaq_f32(sum5, diff5, diff5);

        let x6 = vld1q_f32(ptr_x.add(i + 24));
        let y6 = vld1q_f32(ptr_y.add(i + 24));
        let diff6 = vsubq_f32(x6, y6);
        sum6 = vmlaq_f32(sum6, diff6, diff6);

        let x7 = vld1q_f32(ptr_x.add(i + 28));
        let y7 = vld1q_f32(ptr_y.add(i + 28));
        let diff7 = vsubq_f32(x7, y7);
        sum7 = vmlaq_f32(sum7, diff7, diff7);

        i += 32;
    }

    let s0 = vaddq_f32(sum0, sum1);
    let s1 = vaddq_f32(sum2, sum3);
    let s2 = vaddq_f32(sum4, sum5);
    let s3 = vaddq_f32(sum6, sum7);

    let sum = vaddq_f32(vaddq_f32(s0, s1), vaddq_f32(s2, s3));

    let mut temp = [0.0f32; 4];
    vst1q_f32(temp.as_mut_ptr(), sum);
    temp.iter().sum()
}

/// Fallback standard scalar loop distance calculation (compiled to autovectorized assembly where target features allow).
pub fn l2_distance_scalar(x: &AlignedEmbedding, y: &AlignedEmbedding) -> f32 {
    let mut sum = 0.0;
    for i in 0..768 {
        let diff = x.0[i] - y.0[i];
        sum += diff * diff;
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simd_precision() {
        let mut x_vals = [0.0f32; 768];
        let mut y_vals = [0.0f32; 768];

        for i in 0..768 {
            x_vals[i] = (i as f32) * 0.01;
            y_vals[i] = ((768 - i) as f32) * 0.013;
        }

        let x = AlignedEmbedding::new(&x_vals);
        let y = AlignedEmbedding::new(&y_vals);

        let dist_scalar = l2_distance_scalar(&x, &y);
        let dist_router = l2_distance(&x, &y, None);

        let is_close = |a: f32, b: f32| -> bool {
            let diff = (a - b).abs();
            diff < 1e-3 || (diff / a.abs().max(b.abs())) < 1e-5
        };

        assert!(
            is_close(dist_scalar, dist_router),
            "Scalar ({}) and Router ({}) outputs differ too much!",
            dist_scalar,
            dist_router
        );

        #[cfg(target_arch = "x86_64")]
        {
            if is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma") {
                unsafe {
                    let dist_avx2 = l2_distance_avx2(&x, &y, None);
                    assert!(
                        is_close(dist_scalar, dist_avx2),
                        "Scalar ({}) and AVX2 ({}) outputs differ too much!",
                        dist_scalar,
                        dist_avx2
                    );
                }
            }
            if is_x86_feature_detected!("avx512f") {
                unsafe {
                    let dist_avx512 = l2_distance_avx512(&x, &y, None);
                    assert!(
                        is_close(dist_scalar, dist_avx512),
                        "Scalar ({}) and AVX512 ({}) outputs differ too much!",
                        dist_scalar,
                        dist_avx512
                    );
                }
            }
        }
    }
}
