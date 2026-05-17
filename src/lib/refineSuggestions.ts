/** AI 调整快捷预设：选项页与浮动面板共用；`instruction` 为实际送给模型的修改要求（可与 `label` 不同） */
export type RefinePreset = { label: string; instruction: string };

const INSTRUCTION_EXTRACT_MATERIAL =
  '从【当前提示词】中仅提取与材质、表面质感、触感与材料工艺相关的描述：材料门类（如金属、木材、织物、玻璃、陶瓷、皮革、石材、塑料等）、表面处理（拉丝、磨砂、抛光、做旧、漆艺、电镀、氧化等）、以及颗粒感、反光、透光/半透明、粗糙度、磨损、污渍、涂层厚薄等可在画面中被看出来的质感线索。要求：以忠实还原为优先——尽量保留或紧贴原文措辞，仅在必要时加极少量连接词；严禁编造原文未出现的材料与工艺；原文未提及的类别不要补写；可用逗号或短分句输出，篇幅可较长以换准确度；不要输出主体身份、剧情场景、艺术风格流派、镜头/焦段/AR 参数等非材质内容；不要输出除提取结果外的解释或标题。';

const INSTRUCTION_EXTRACT_STYLE =
  '从【当前提示词】中仅提取与画面风格、艺术流派、整体氛围与镜头/画面气质相关的描述：媒介感（插画、厚涂、写实、3D 渲染、矢量、像素等）、流派或时代调性（如赛博朋克、极简、巴洛克、胶片感、日系清新等）、色彩与对比倾向、光线气质（柔光、硬光、体积光、边缘光等）、景别与构图气质（广角张力、长焦压缩、对称、留白、荷兰角等）、参考艺术家/作品气质若原文有提及。要求：以忠实还原为优先——逐条对齐原文表述，避免把丰富描述压缩成少数空泛词；严禁添加原文没有的风格或镜头词；不要混入纯材质清单或物体枚举；可用逗号或短分句输出，篇幅可较长以覆盖层次；不要输出完整重写后的整段生图提示词；不要输出除提取结果外的解释或标题。';

export const REFINE_PRESETS: RefinePreset[] = [
  { label: '翻译成英文', instruction: '翻译成英文' },
  { label: '翻译成中文', instruction: '翻译成中文' },
  { label: '改得更电影感', instruction: '改得更电影感' },
  { label: '扩写提示词', instruction: '扩写提示词' },
  { label: '优化提示词', instruction: '优化提示词' },
  { label: '提取材质', instruction: INSTRUCTION_EXTRACT_MATERIAL },
  { label: '提取风格', instruction: INSTRUCTION_EXTRACT_STYLE },
  { label: '更改主体为xxx', instruction: '更改主体为xxx' },
  { label: '精简成不超过 30 字', instruction: '精简成不超过 30 字' },
];
