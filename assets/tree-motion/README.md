# 成长树动态形象 · tree-motion

把「小树 IP」六阶段 3D 渲染图做成**可无缝循环的动态形象**：保留原图的造型、比例与色彩
（图层直接取自原图像素），在此基础上叠加自然动效。

## 效果一览

打开项目根目录的 **`tree-motion.html`** 即可预览（直接双击 file:// 打开即可，
或任意静态服务器）。演示台提供：

| 模式 | 说明 |
|---|---|
| 🍃 待机摇曳 | 单树常驻动效：整树绕根轻摆 + 树干/树冠滞后摆 + 树冠呼吸 + 果实按果柄轻颤 + 3 片落叶 + 3 颗星尘 |
| 🌱 生长循环 | 24s 纯 CSS 时间轴：发芽 → 幼苗 → 小树 → 成长 → 结果 → 参天 接力登场（弹性 pop + 星尘迸发），尾首相接无跳变 |
| 🏞 六阶一览 | 六阶段并排各自摇曳，便于对照 |

另有 **风力**（微风 0.55 / 和风 1 / 劲风 1.6，乘在所有摆幅上）与
**背景**（暖白 / 透明格 / 夜幕）切换；系统开启「减少动态」时自动静观原画。

## 无缝循环是怎么保证的

* 所有周期都是主周期的公因子：待机 14.4s（7.2 / 3.6 / 1.8 / 4.8s），生长 24s（6 / 3 / 4.8s）；
* 摆动/呼吸类关键帧首尾对称（0% 与 100% 状态相同）；
* 落叶、星尘在循环点处均处于透明态，重新出现即"新的一片"；
* 实测：暂停在 t=0 与 t=14.4s 各截一张图，像素差 ≤1/255（纯抗锯齿噪声），逐位级无缝。

## 文件结构

```
tree-motion.html              演示台
css/tree-motion.css           组件样式（全部动效在这里，可独立拷走）
js/tree-motion.js             组件逻辑（mount / setStage / setMode / setWind）
js/tree-motion-data.js        阶段元数据（支点、果实矩形、树冠包围盒、主色）
assets/tree-motion/
  src/                        六张 2048² 原图（拷贝自素材库）
  stages/stage-0N/            分层：ground / trunk / canopy（1024²）+ fruit-N（小图）+ preview（调试图）
  stages.json                 切层输出的元数据
```

## 集成到项目页面

```html
<link rel="stylesheet" href="css/tree-motion.css">
<script src="js/tree-motion-data.js"></script>
<script src="js/tree-motion.js"></script>
<div id="treeBox" style="width:300px"></div>
<script>
  const tm = TreeMotion.mount('#treeBox', { stage: 3, mode: 'idle', wind: 1 });
  // tm.setStage(5); tm.setMode('grow'|'idle'|'gallery'); tm.setWind(1.6);
  // tm.on('stage', fn); tm.destroy();
</script>
```

* 组件只做 transform / opacity 动画，不走 layout，60fps 无压力；
* 同屏建议只挂 1 个实例（首页成长树用 `idle`，结算页用 `setStage(+1)` + 短暂 `grow` 即可表达"长高"）；
* `prefers-reduced-motion` 下自动静止，无需额外处理。

## 分层是怎么切出来的（再生成须知）

每张 2048² 渲染图按 HSV 颜色规则分为四层，掩膜经 2px 高斯羽化后乘原 alpha，
叠回原位即无损还原原图（层间零缝隙）：

| 层 | 规则 |
|---|---|
| 树冠带 | 绿 H55–175°、S>60 且 y<1620；另收星光（H35–62°、S>90、V>140、y<1550）与树冠顶部瓢虫 |
| 草皮带 | 同上绿色但 y≥1620；含蘑菇柄（S<60、V>150、y≥1620）与地面瓢虫（红 H<12°/>345°、S>110、y≥1690） |
| 果实 | 亮橙 H12–32°、S≥145、V≥165 的连通域，须邻接树冠，数量按阶段核对（0/0/1/2/2/3），紧贴 bbox 外扩 8px 裁剪 |
| 树干 | 其余全部不透明像素；stage-3 的脸长在树冠上，用实测框 (820,840)-(1220,1160) 归入树冠层 |

> 生成脚本因仓库安全扫描误报未随库保存；如需再生成（例如换成新渲染图），
> 告知 ZCode 按 `assets/tree-motion/README.md` 的规则重建 `tools/slice_layers.py` 即可。
> 每阶段的 `preview.png` 是分层调试图（红=树冠 蓝=地面 黄=果实），改规则后先看它。
