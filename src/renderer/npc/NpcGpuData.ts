export type NpcGpuFrameData = Readonly<{
    width: number;
    height: number;
    data: Uint16Array;
}>;

export type NpcGpuDataConsumer = Readonly<{
    setNpcGpuFrameData(data: NpcGpuFrameData): void;
}>;

