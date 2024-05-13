export class ModelHeader {
    public modelData: number[];

    public vertexCount: number;

    public triangleCount: number;

    public texturedTriangleCount: number;

    public vertexDirectionOffset: number;

    public xDataOffset: number;

    public yDataOffset: number;

    public zDataOffset: number;

    public vertexSkinOffset: number;

    public triangleDataOffset: number;

    public triangleTypeOffset: number;

    public colorDataOffset: number;

    public texturePointerOffset: number;

    public trianglePriorityOffset: number;

    public triangleAlphaOffset: number;

    public triangleSkinOffset: number;

    public uvMapTriangleOffset: number;

    constructor() {
        this.modelData = [];
        this.vertexCount = 0;
        this.triangleCount = 0;
        this.texturedTriangleCount = 0;
        this.vertexDirectionOffset = 0;
        this.xDataOffset = 0;
        this.yDataOffset = 0;
        this.zDataOffset = 0;
        this.vertexSkinOffset = 0;
        this.triangleDataOffset = 0;
        this.triangleTypeOffset = 0;
        this.colorDataOffset = 0;
        this.texturePointerOffset = 0;
        this.trianglePriorityOffset = 0;
        this.triangleAlphaOffset = 0;
        this.triangleSkinOffset = 0;
        this.uvMapTriangleOffset = 0;
    }
}
