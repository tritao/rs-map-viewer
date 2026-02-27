#pragma once

#include "../../types.hpp"

namespace rs {

// Mirrors src/rs/model/skeletal/SkeletalTransformType.ts.
enum class SkeletalTransformType : i32 {
    NONE = 0,
    BONE = 1,
    BILLBOARD_TRANSFORM_A = 2,
    LIGHT = 3,
    ALPHA = 4,
    BILLBOARD_TRANSFORM_B = 5,
};

inline SkeletalTransformType getSkeletalTransformTypeForId(i32 id) noexcept {
    if (id < 0 || id > static_cast<i32>(SkeletalTransformType::BILLBOARD_TRANSFORM_B)) {
        return SkeletalTransformType::NONE;
    }
    return static_cast<SkeletalTransformType>(id);
}

inline i32 getSkeletalCurveCount(SkeletalTransformType type) noexcept {
    switch (type) {
        case SkeletalTransformType::NONE: return 0;
        case SkeletalTransformType::BONE: return 9;
        case SkeletalTransformType::BILLBOARD_TRANSFORM_A: return 3;
        case SkeletalTransformType::LIGHT: return 6;
        case SkeletalTransformType::ALPHA: return 1;
        case SkeletalTransformType::BILLBOARD_TRANSFORM_B: return 3;
    }
    return 0;
}

} // namespace rs
