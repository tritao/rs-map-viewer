#pragma once

#include "../../types.hpp"

namespace rs {

// Mirrors src/rs/model/skeletal/SkeletalTransformType.ts.
enum class SkeletalTransformType : i32 {
    TYPE_0 = 0,
    BONE = 1,
    TYPE_2 = 2,
    TYPE_3 = 3,
    ALPHA = 4,
    TYPE_5 = 5,
};

inline SkeletalTransformType getSkeletalTransformTypeForId(i32 id) noexcept {
    if (id < 0 || id > static_cast<i32>(SkeletalTransformType::TYPE_5)) {
        return SkeletalTransformType::TYPE_0;
    }
    return static_cast<SkeletalTransformType>(id);
}

inline i32 getSkeletalCurveCount(SkeletalTransformType type) noexcept {
    switch (type) {
        case SkeletalTransformType::TYPE_0: return 0;
        case SkeletalTransformType::BONE: return 9;
        case SkeletalTransformType::TYPE_2: return 3;
        case SkeletalTransformType::TYPE_3: return 6;
        case SkeletalTransformType::ALPHA: return 1;
        case SkeletalTransformType::TYPE_5: return 3;
    }
    return 0;
}

} // namespace rs
