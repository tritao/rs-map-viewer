// Terrain contouring modes for location models.
//
// These values come from `LocType.contourGroundType` and are applied by `Model.contourGround()`.
// Type 3 is "align to slope" (rotate/translate to match the terrain plane), as per rt4 client logic.
export enum ContourGroundType {
    None = 0,
    // Warp all vertices in Y to match terrain height under each vertex.
    WarpToTerrain = 1,
    // Warp lower vertices with a fade-out towards the top (uses `param` as a cutoff/strength).
    WarpToTerrainFadeByVertexHeight = 2,
    // Align to terrain slope (rotate around X/Z + translate), without per-vertex warping.
    // TODO: implement in `Model.contourGround()`/`ModelData.contourGround()`.
    AlignToSlope = 3,
    // Warp using the heightmap of the plane above.
    WarpToPlaneAbove = 4,
    // Warp between current plane and plane above.
    WarpBetweenPlanes = 5,
}

