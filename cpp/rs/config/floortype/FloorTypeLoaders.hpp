#pragma once

#include "../ArchiveTypeLoader.hpp"
#include "OverlayFloorType.hpp"
#include "UnderlayFloorType.hpp"

namespace rs {

using UnderlayFloorTypeLoader = ArchiveTypeLoader<UnderlayFloorType>;
using OverlayFloorTypeLoader = ArchiveTypeLoader<OverlayFloorType>;

} // namespace rs

