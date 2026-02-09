#pragma once

#include "../../types.hpp"

namespace rs {

// Mirrors src/rs/config/vartype/VarProvider.ts.
struct VarProvider {
    virtual ~VarProvider() = default;
    virtual i32 getVarp(i32 id) const noexcept = 0;
    virtual i32 getVarbit(i32 id) const noexcept = 0;
};

} // namespace rs
