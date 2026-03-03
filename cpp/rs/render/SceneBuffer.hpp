#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "SceneCommandBuilder.hpp"

namespace rs {

enum class ContourGroundType : i32 {
    CenterTile = 0,
    Vertex = 1,
    None = 2,
};

enum class InteractType : i32 {
    None = 0,
    Loc = 1,
    Obj = 2,
    Npc = 3,
};

enum class DrawBucketKey : i32 {
    Base = 0,
    Alpha = 1,
    Lod = 2,
    LodAlpha = 3,
    Interact = 4,
    InteractAlpha = 5,
    InteractLod = 6,
    InteractLodAlpha = 7,
};

static constexpr i32 kDrawBucketCount = 8;

struct ModelInfo final {
    i32 sceneX = 0;
    i32 sceneZ = 0;
    i32 heightOffset = 0;
    i32 level = 0;
    i32 contourGround = static_cast<i32>(ContourGroundType::None);
    i32 priority = 0;
    i32 interactType = static_cast<i32>(InteractType::None);
    i32 interactId = 0xffff;
};

enum class DebugCommandSourceKind : i32 {
    Unknown = 0,
    Terrain = 1,
    LocInstanced = 2,
    LocMergeBucket = 3,
    LocMergedDummy = 4,
    LocAnimated = 5,
};

struct DebugCommandProvenance final {
    i32 sourceKind = static_cast<i32>(DebugCommandSourceKind::Unknown);
    i32 locTypeId = -1;
    i32 placementType = -1;
    i32 placementRotation = -1;
    i32 variantType = -1;
    i32 variantRotation = -1;
    i32 pass = -1;
    i32 mergePath = 0;
    i32 splitSignature = 0;
};

struct DrawCommand final {
    i32 offset = 0;
    i32 elements = 0;
    i32 instanceStart = 0;
    i32 instanceCount = 0;
    // 0 = immediate pool, 1 = deferred pool (used to preserve TS command/instance ordering:
    // instanced ops first, merged groups appended after).
    u8 instancePoolKind = 0;
    DebugCommandProvenance debugProvenance{};
};

// C++ equivalent of the TS SceneBuffer command-bucket layer.
// Geometry/vertex build will be layered on top of this type.
struct SceneBuffer final {
    // Packed vertex bytes (TS SceneBuffer owns the geometry buffers).
    Vec<u8> vertices{};
    Vec<i32> indices{};
    Vec<ModelInfo> instances{};
    Vec<ModelInfo> deferredInstances{};

    Vec<DrawCommand> drawCommands{};
    Vec<DrawCommand> drawCommandsAlpha{};
    Vec<DrawCommand> drawCommandsLod{};
    Vec<DrawCommand> drawCommandsLodAlpha{};
    Vec<DrawCommand> drawCommandsInteract{};
    Vec<DrawCommand> drawCommandsInteractAlpha{};
    Vec<DrawCommand> drawCommandsInteractLod{};
    Vec<DrawCommand> drawCommandsInteractLodAlpha{};

    Vec<DrawCommand> deferredDrawCommands{};
    Vec<DrawCommand> deferredDrawCommandsAlpha{};
    Vec<DrawCommand> deferredDrawCommandsLod{};
    Vec<DrawCommand> deferredDrawCommandsLodAlpha{};
    Vec<DrawCommand> deferredDrawCommandsInteract{};
    Vec<DrawCommand> deferredDrawCommandsInteractAlpha{};
    Vec<DrawCommand> deferredDrawCommandsInteractLod{};
    Vec<DrawCommand> deferredDrawCommandsInteractLodAlpha{};

    Result<void> init(Allocator& alloc) noexcept;
    void clear() noexcept;

    [[nodiscard]] i32 indexByteOffset() const noexcept;

    Status addIndex(i32 index) noexcept;
    Status appendIndices(Span<const i32> values) noexcept;

    Status emitCommandToBucket(
        DrawBucketKey bucket,
        i32 offset,
        i32 elements,
        Span<const ModelInfo> commandInstances,
        bool defer = false,
        const DebugCommandProvenance* debugProvenance = nullptr) noexcept;

    Status emitMergedCommand(
        i32 offset,
        i32 elements,
        Span<const ModelInfo> commandInstances,
        bool transparent,
        bool includeLod,
        bool defer = false,
        const DebugCommandProvenance* debugProvenance = nullptr) noexcept;

    Status emitInteractCommand(
        i32 offset,
        i32 elements,
        Span<const ModelInfo> commandInstances,
        bool transparent,
        bool includeLod,
        bool defer = false,
        const DebugCommandProvenance* debugProvenance = nullptr) noexcept;

    [[nodiscard]] i32 bucketCommandCount(DrawBucketKey bucket) const noexcept;
    [[nodiscard]] Span<const DrawCommand> bucketCommands(DrawBucketKey bucket) const noexcept;
    [[nodiscard]] Span<const DrawCommand> bucketDeferredCommands(DrawBucketKey bucket) const noexcept;

    // Ensure indices/vertices are consistent and deduped after all geometry emission.
    // `indexCount` is the number of indices referenced by command ranges.
    // Debug: when debugProbeFinalVertexIndex >= 0, report the first pre-dedupe vertex index
    // that produced the deduped vertex at that final index (and copy its packed u32 words).
    Status finalizeGeometry(
        i32 indexCount,
        i32 debugProbeFinalVertexIndex,
        i32* outProbeOldVertexIndex,
        i32* outProbeVertexU32,
        Allocator& alloc = defaultAllocator()) noexcept;

    Status appendCommandStream(
        SceneCommandStream* out,
        Allocator& alloc = defaultAllocator()) const noexcept;

	private:
    [[nodiscard]] Vec<DrawCommand>* bucketVec(DrawBucketKey bucket, bool defer) noexcept;
    [[nodiscard]] const Vec<DrawCommand>* bucketVec(DrawBucketKey bucket, bool defer) const noexcept;

    Status emitToBuckets(
        Span<const DrawBucketKey> buckets,
        i32 offset,
        i32 elements,
        Span<const ModelInfo> commandInstances,
        bool defer,
        const DebugCommandProvenance* debugProvenance) noexcept;
};

Status packDrawRangesForBucket(
    const SceneBuffer& buffer,
    DrawBucketKey bucket,
    Vec<i32>* outDrawRanges,
    Allocator& alloc = defaultAllocator()) noexcept;

Status createModelInfoTextureData(
    const SceneBuffer& buffer,
    DrawBucketKey bucket,
    Vec<u16>* outTextureData,
    Allocator& alloc = defaultAllocator()) noexcept;

} // namespace rs
