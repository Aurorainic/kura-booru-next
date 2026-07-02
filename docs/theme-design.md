# Kura Booru — Theme 设计稿

> 在现有设计语言基础上,从"毛坯"发展到"精装"。
> 设计方向:**画廊型(图片优先)**,参考 Unsplash / Are.na 的沉浸式浏览,
> 标签和元数据退居二线,按需出现。
>
> 不是推翻重来——现有 oklch 色彩系统、cyan 渐变 accent、glassmorphism nav、
> noise texture、masonry staggered 动画全部保留,作为设计语言的基础词汇。
> 这份文档定义如何把这些词汇组织成有节奏、有层次、有个性的"装修方案"。

---

## 一、设计主张

一句话:**让图片成为主角,界面退为环境。**

当前"毛坯感"的根源不是缺功能,而是界面元素和图片争夺注意力:

| 现状 | 问题 | 精装方向 |
|---|---|---|
| 图片卡片有 border + radius + shadow | 像"装裱的照片",有边界感 | 无边框,图片直接贴在背景上,shadow 仅 hover 时出现 |
| 所有卡片完全等价,masonry 均质 | 无视觉节奏,浏览疲劳 | 首屏第一张做"featuring"大图,其余正常网格 |
| 导航栏 + 公告 + 标题 + 筛选 + 网格 | 页面顶部信息密集 | 导航极简(搜索即导航),标题/筛选折叠到滚动后出现 |
| 详情页三栏(标签\|图片\|信息) | 传统 booru 布局,信息争夺图片空间 | 图片全宽沉浸,标签/信息浮层式按需出现 |
| 字体 system-ui | 无个性,和任何网站一样 | 引入展示字体(标题/数字用),正文保持 system-ui |
| 入场动画统一 slide-up+fade | 所有元素"性格"相同 | 图片用 blur-reveal、文字用 mask-wipe、数字用 count-up |

---

## 二、色彩系统升级

### 2.1 环境色基调(现有基础的微调)

当前 dark mode 的 `oklch(14% 0.008 260)` 是中性的冷灰。画廊型网站需要更有"环境感"的底色——让图片像挂在有微妙色调的墙面上,而非悬浮在纯灰中。

```css
/* 现有 */
--color-dark-bg: oklch(14% 0.008 260);       /* 冷灰 */
--color-dark-surface: oklch(18% 0.01 260);

/* 精装:降彩度但加暖偏,接近"深墨"而非"深灰" */
--color-dark-bg: oklch(13% 0.012 270);       /* 微暖墨色 */
--color-dark-surface: oklch(17% 0.014 268);
--color-dark-surface-alt: oklch(21% 0.016 266);
```

light mode 同理——当前 `oklch(99% 0.002 240)` 是纯白偏冷,改为微暖的"纸白":

```css
/* 精装 */
--color-light-bg: oklch(98.5% 0.004 80);     /* 微暖纸白 */
--color-light-surface: oklch(100% 0 0);
--color-light-surface-alt: oklch(97% 0.005 80);
```

变化极小(±2% chroma、±20° hue),但累积感知是"这个空间有温度"而非"这个空间是灰色的"。

### 2.2 标签分类色(现有基础的扩展)

当前 5 种分类色是独立的小色点。精装后,分类色成为信息架构的视觉骨架:

```css
/* 现有:小色点 + 淡背景 */
.tag-artist { color: var(--color-tag-artist); background: oklch(.../0.1); }

/* 精装:增加"分类带"——标签行左侧 2px 竖条,分类色全饱和 */
.tag-badge {
  border-left: 2px solid var(--category-color);
  padding-left: 6px;
}
```

在详情页标签侧栏,每个分类区块顶部增加一条 3px 分类色横条作为分组分隔,取代当前的文字标题。视觉上"色带即分类",不需要读文字就能扫到想找的分类。

### 2.3 Rating 色彩(现有基础的强化)

当前 rating badge 是小药丸。画廊型中,rating 信息应该更克制——不在卡片上抢眼,但详情页中要有"环境色"级别的存在感:

详情页根据 rating 微调页面环境色(仅暗色模式):
- safe:无变化(默认环境色)
- questionable:背景微暖(+0.02 chroma, +10° hue → 偏琥珀)
- explicit:背景微红(+0.02 chroma, +20° hue toward red)

这是潜意识级别的色彩暗示,用户不会注意到但能感知到"这个空间的气氛变了"。

---

## 三、版式系统

### 3.1 字体策略

引入两个层次:

| 用途 | 字体 | 理由 |
|---|---|---|
| 正文/标签/元数据 | system-ui(现有) | 可读性、零加载、不抢眼 |
| 标题(H1/页面标题) | **HarmonyOS Sans / 思源黑体** | 中文展示更挺拔,字重范围广,开源免费 |
| 数字(计数/尺寸/文件大小) | **JetBrains Mono**(现有 font-mono) | tabular-nums 对齐,技术感 |

标题字体通过 `@font-face` 自托管(仅 woff2,~80KB),只在页面有 H1 时加载。标签和正文不加载体外字体,保持零 JS 公共页面的原则。

### 3.2 字号节奏

当前标题用 `clamp(1.5rem, 2.5vw, 2rem)` 是安全的响应式,但缺乏层次。精装后:

```css
/* 页面主标题(画廊/搜索/标签页 H1) */
--font-size-display: clamp(1.75rem, 1.2rem + 2.8vw, 3rem);
/* 副标题/区域标题 */
--font-size-title: clamp(1.125rem, 1rem + 0.6vw, 1.375rem);
/* 正文 */
--font-size-body: 0.9375rem;  /* 15px,比当前 14px 略大,更松弛 */
/* 元数据/标签 */
--font-size-meta: 0.8125rem;  /* 13px,保持现有 */
/* 微信息(角标/计数) */
--font-size-micro: 0.6875rem; /* 11px,保持现有 */
```

画廊型需要更大的标题——因为标题周围留白多,小标题会显得"空旷"。大标题填充空间,制造"展览入口"的感觉。

### 3.3 间距节奏

当前所有间距是 `py-6` / `gap-3` / `mb-8` 的离散值。精装后引入"呼吸节奏":

```css
/* 页面级:更大的顶部留白,让内容"落在"空间中而非"贴着"顶部 */
--space-page-top: 2rem;       /* 桌面,移动端 1.5rem */
--space-section: 3rem;        /* 区块间距,比当前 mb-8(2rem)更松弛 */

/* 卡片级:网格间距收窄,让图片更密集 */
--space-grid-gap: 0.5rem;     /* 当前 gap-3 = 0.75rem,收窄后更"满" */
```

画廊型的核心矛盾:图片要密集(沉浸感)但页面要松弛(空间感)。解法是**网格内密集、网格外松弛**——masonry gap 收窄,但页面 padding 和区块间距加大。

---

## 四、布局重构

### 4.1 首页画廊(从均质到有节奏)

**现有:** CSS columns 2-7 列,所有卡片等价,gap-3。

**精装:Featuring + 密集网格**

```
┌─────────────────────────────────────────────┐
│  ←  导航(极简,搜索即导航)              ←  │
├─────────────────────────────────────────────┤
│                                             │
│  画廊                              搜索 □   │  ← 大标题 + 搜索,同层
│  1,234 张插画                               │
│                                             │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │  Featuring: 最新/精选大图(占 2 列宽)    │ │  ← 首屏第一张,跨 2 列
│ │  ~400px 高                               │ │
│ └─────────────────────────────────────────┘ │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌────┐ │
│ │      │ │      │ │      │ │      │ │    │ │  ← 其余正常网格
│ └──────┘ └──────┘ └──────┘ └──────┘ └────┘ │
│ ...                                         │
└─────────────────────────────────────────────┘
```

实现:masonry 第一项 `break-inside: avoid; column-span: 2`(或用 CSS grid 的 `grid-column: span 2` 做第一行 featured,第二行起切换为 columns masonry)。

featured 卡片图片更高(显示 preview 而非 thumb),hover 时底部浮现标题 + 来源 + 标签。不 featured 的卡片保持现有行为。

**不改变的核心:** 仍然是 SSR HTML,零 JS,分页器不变,Cookie per-page 不变。

### 4.2 详情页(从三栏到沉浸式)

**现有:** 左标签栏(220px) | 中图片 | 右信息栏(280px)

**精装:图片沉浸 + 浮层信息**

```
┌─────────────────────────────────────────────┐
│  ← 返回                          [标签] [信息] │  ← 顶栏只有"返回"和两个 toggle
├─────────────────────────────────────────────┤
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ │         全宽图片(最大 1200px 居中)      │ │  ← 图片是绝对主角
│ │         点击放大(modal pan/zoom)        │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│  作品标题                                    │  ← 图片下方:标题 + 来源 + 评级
│  Pixiv · 1920×1080 · 2.3MB · 2024-01-15    │
│                                             │
│  [公开]  [查看原图]  [删除]                  │  ← 操作行(admin 可见删除)
│                                             │
├─────────────────────────────────────────────┤
│  标签                                        │  ← 滚动后:标签区(展开式)
│  ┃作品  fate/grand_order  saber...          │  ← 分类色带 + 标签流
│  ┃角色  artoria_pendragon ...                │
│  ┃画师  wsman...                             │
│  ┃通用  1girl  blonde_hair  ...              │
│                                             │
├─────────────────────────────────────────────┤
│  相关标签 → (共现 Top 10,可点击叠加搜索)    │
└─────────────────────────────────────────────┘
```

桌面端:标签和信息不再占据侧栏空间,而是滚动到图片下方时出现。顶部有"标签"/"信息"按钮可以快速跳转(`scrollIntoTo`)。

移动端:标签/信息默认折叠在图片下方,点击展开手风琴。

**不改变的核心:** 标签分类逻辑不变、admin 标签管理(✕移除/添加)不变、评级编辑不变、modal 不变。只是布局从"并列"改为"堆叠+按需展开"。

### 4.3 导航极简(从信息密集到搜索即导航)

**现有:** logo + 搜索 + 标签 + 随机 + 分隔线 + admin/登录 + 主题 + 强调色 + 移动菜单

**精装:**

```
桌面端:
┌─────────────────────────────────────────────┐
│  K  搜索...                          ◐  ◑  │  ← logo + 搜索框(占大部分宽度) + 主题 + 强调色
└─────────────────────────────────────────────┘

滚动后(粘性收缩):
┌─────────────────────────────────────────────┐
│  K  搜索...                    ◐  ◑        │  ← 搜索框收缩,标签/随机/admin 收进搜索框右侧的 "..." 菜单
└─────────────────────────────────────────────┘
```

"..." 菜单展开:
```
┌──────────┐
│ 标签     │
│ 随机     │
│ ───────  │
│ 管理后台 │  (admin)
│ 退出     │  (admin)
│ ───────  │
│ 登录     │  (非 admin)
└──────────┘
```

移动端:导航只有 logo + 搜索图标,所有导航项在搜索页的底部 tab bar 中。

**不改变的核心:** 所有导航目标都保留,只是视觉权重重新分配。搜索成为主要导航方式(画廊型的核心交互),其他入口退为次要。

### 4.4 标签页(从表格到视觉标签库)

**现有:** 标签云 + 表格(桌面)/ 卡片(移动)

**精装:标签星座图**

```
┌─────────────────────────────────────────────┐
│  标签                                       │
│  1,234 个                                   │
│                                             │
│  [全部] [画师] [角色] [作品] [通用] [元信息] │  ← 分类筛选
│  数量 ↑ / 名称 ↑                            │
│                                             │
│         ●hatsune_miku                       │  ← 大字 + 分类色 + 计数
│        1,234                                 │
│              ●saber                         │
│             892                              │
│  ●wsman                                     │
│  567                                         │
│                    ●1girl                    │
│                   4,521                      │
│                                             │
│  ← 按 post_count 大小自动排版,               │
│     大标签散布,小标签填充间隙                 │
└─────────────────────────────────────────────┘
```

用 CSS grid + `font-size: calc(...)` 按 post_count 映射字号(现有标签云已有这个逻辑),但精装后:

- 标签名用展示字体(非 system-ui)
- 分类色不是小色点,而是标签文字本身的颜色(淡化的分类色)
- hover 时标签放大 + 显示翻译 + 显示 danbooru_name
- 没有表格——标签云即全部内容,分页在底部

移动端:标签云自动转为 2 列流式布局,字号范围压缩。

**不改变的核心:** 分类筛选、排序、分页逻辑不变。

### 4.5 搜索页(从表单到探索界面)

**现有:** 居中搜索框 + 来源 chips + 结果网格

**精装:搜索即探索**

```
┌─────────────────────────────────────────────┐
│  搜索                                       │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  hatsune_miku + ...                 │   │  ← 大搜索框,占 60% 宽度居中
│  └─────────────────────────────────────┘   │
│  试试: hatsune_miku  saber  fate/grand... │  ← 热门标签建议(从 DB 取 Top 10)
│                                             │
│  来源: [全部] [Pixiv] [Twitter] [Danbooru] │
│                                             │
│  42 个结果                                  │
│                                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ...            │  ← 结果网格(同首页 masonry)
│  └──────┘ └──────┘ └──────┘                │
└─────────────────────────────────────────────┘
```

无搜索时:搜索框下方显示"最近搜索"(localStorage)+ "热门标签"(DB Top 10),鼓励探索。

有搜索时:Autocomplete 建议带分类色 + 计数(之前提出的,这里纳入设计系统)。

**不改变的核心:** 搜索语法、来源筛选、分页、未解析标签提示全部保留。

---

## 五、图片展示系统

### 5.1 卡片去装裱化

**现有:**
```css
.masonry-item {
  border-radius: var(--radius-lg);  /* 14px 圆角 */
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}
```

**精装:**
```css
.masonry-item {
  border-radius: 4px;  /* 极小圆角,几乎直角但有"印刷品"感 */
  border: none;
  background: transparent;
  box-shadow: none;
  overflow: hidden;
}
.masonry-item:hover {
  box-shadow: 0 12px 40px oklch(0% 0 0 / 0.15);  /* 仅 hover 时浮起 */
  transform: translateY(-2px);
  border-radius: 8px;  /* hover 时圆角微张 */
}
```

图片直接贴在背景上,无 border 无 shadow。hover 时才"浮起",有"从墙面取下"的感觉。

### 5.2 入场动画性格化

**现有:** 全部 `cardIn`(translateY + scale + opacity,40ms stagger)

**精装:Blur Reveal**

```css
@keyframes blurReveal {
  from {
    opacity: 0;
    filter: blur(8px);
    transform: scale(1.02);
  }
  to {
    opacity: 1;
    filter: blur(0);
    transform: scale(1);
  }
}
.masonry-item {
  animation: blurReveal 0.6s var(--ease-out) both;
}
```

blur 从 8px 收锐到 0,像"对焦"的感觉——图片从模糊到清晰,符合画廊型"看图"的核心交互。stagger 保留但延长到 60ms(blur 动画需要更长才能感知)。

**文字动画不同:**
```css
@keyframes maskWipe {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
h1 { animation: maskWipe 0.8s var(--ease-out) both; }
```

文字从左到右"揭开",和图片的 blur reveal 形成"图片聚焦 → 文字揭示"的叙事顺序。

**数字动画:**
```css
@keyframes countUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

计数数字用 countUp(简洁的上滑),和图片/文字区分。

### 5.3 渐进式加载升级(LQIP)

**现有:** skeleton shimmer(灰色闪烁) → 图片

**精装:Sidecar 生成 LQIP → blur placeholder → 图片**

sidecar 在生成缩略图时,额外生成 20×20px WebP base64(约 200 bytes),嵌入 API 响应的 `lqip` 字段:

```json
{ "id": "...", "preview_key": "...", "lqip": "data:image/webp;base64,UklGR..." }
```

前端渲染:
```html
<div class="img-container" style="aspect-ratio: W / H">
  <img class="lqip-blur" src="{lqip}" alt="" aria-hidden="true">
  <img class="img-real" src="/i/preview/..." onload="this.classList.add('loaded')">
</div>
```

```css
.img-container { position: relative; overflow: hidden; }
.lqip-blur {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; filter: blur(20px) scale(1.1);
  transition: opacity 0.5s;
}
.img-real {
  position: relative; opacity: 0;
  transition: opacity 0.5s;
}
.img-real.loaded { opacity: 1; }
.img-real.loaded + .lqip-blur,
.img-real.loaded ~ .lqip-blur { opacity: 0; }
```

用户看到的是图片的模糊轮廓即时出现,然后清晰图淡入替换。相比灰色 shimmer,感知速度大幅提升。

**保留 skeleton shimmer 作为 fallback:** 如果 `lqip` 字段为空(旧数据),回退到现有 shimmer。

### 5.4 详情页图片展示

**现有:** blur placeholder(thumbnail)→ original,有 card border

**精装:全宽沉浸 + 渐进式**

```
图片最大宽度 1200px,居中,无 border 无 card 容器。
背景色和页面背景一致,图片"浮"在空间中。

加载顺序:
1. LQIP 20×20 模糊(base64 即时)
2. Preview 1024px(快速加载,可看清明内容)
3. Original(按需——仅当用户点击"查看原图"或放大时加载 full res)
```

当前是直接加载 original(`getOriginalUrl`),对大图来说浪费带宽。精装后默认加载 preview,original 仅 modal/下载时使用。

**不改变的核心:** modal 放大逻辑保留,但升级为 pan/zoom(滚轮缩放 + 拖拽)。

---

## 六、组件设计语言

### 6.1 标签徽章(TagBadge)

**现有:** 色点 + 文字

**精装:**

```
桌面:
┃ hatsune_miku  1,234
   ┃ 分类色竖条(2px)
   标签名(展示字体,分类色淡化)
   计数(mono,灰色)

hover:
┃ hatsune_miku 初音未来  1,234
                ↑ 翻译出现(如果有)
```

```css
.tag-badge {
  display: inline-flex; align-items: baseline; gap: 4px;
  border-left: 2px solid var(--category-color);
  padding-left: 6px;
}
.tag-badge .name {
  font-family: var(--font-display);
  color: var(--text-primary);
  transition: color 0.15s;
}
.tag-badge:hover .name { color: var(--category-color); }
.tag-badge .translation {
  font-size: 0.75em; color: var(--text-muted);
  opacity: 0; transition: opacity 0.2s;
}
.tag-badge:hover .translation { opacity: 0.8; }
.tag-badge .count {
  font-family: var(--font-mono); font-size: 0.75em;
  color: var(--text-muted); margin-left: auto;
}
```

### 6.2 筛选器(FilterChip)

**现有:** pill 形状,border + 背景色变化

**精装:**

```
未选中:  全部     (纯文字,下划线透明)
选中:    全部     (文字变 accent 色,下方 2px accent 色下划线滑入)
hover:   全部     (文字 accent 色,下划线半透明)
```

```css
.filter-chip {
  padding: 4px 0; border: none; background: none;
  color: var(--text-muted); font-weight: 500;
  position: relative; transition: color 0.15s;
}
.filter-chip::after {
  content: ''; position: absolute; left: 0; bottom: -2px;
  width: 100%; height: 2px; background: var(--accent-color);
  transform: scaleX(0); transform-origin: left;
  transition: transform 0.2s var(--ease-out);
}
.filter-chip:hover { color: var(--accent-color); }
.filter-chip:hover::after { transform: scaleX(0.4); }
.filter-chip.active { color: var(--accent-color); }
.filter-chip.active::after { transform: scaleX(1); }
```

从"药丸"变为"下划线标签"——更克制,不争夺图片注意力。accent 下划线滑入有"选中"的确认感。

### 6.3 按钮(Button)

**现有:** 实心 accent 背景 + 圆角 + active scale

**精装:两层视觉层级**

```
主要按钮(查看原图/保存/导入):
  实心 accent,白字,无圆角或极小圆角(2px)
  hover: accent-hover + 微微上浮 + accent glow shadow
  active: 下沉

次要按钮(返回/取消):
  纯文字 + accent 色 + 下划线(同 filter-chip 风格)

危险按钮(删除):
  纯文字 + danger 色 + hover 时出现 danger 色描边
  无实心红色背景(避免视觉过重)
```

```css
.btn-primary {
  background: var(--accent-color); color: var(--bg-primary);
  border: none; border-radius: 2px;
  font-weight: 600; font-size: 0.875rem;
  padding: 0.625rem 1.5rem;
  transition: all 0.15s var(--ease-out);
}
.btn-primary:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-accent-glow);
}
.btn-primary:active { transform: translateY(0); }

.btn-ghost {
  background: none; border: none; color: var(--accent-color);
  font-weight: 500; font-size: 0.875rem;
  position: relative;
}
.btn-ghost::after { /* 同 filter-chip 下划线 */ }

.btn-danger {
  background: none; border: 1px solid transparent;
  color: var(--color-danger); font-weight: 500;
  transition: all 0.15s;
}
.btn-danger:hover { border-color: var(--color-danger); }
```

### 6.4 分页器(Pagination)

**现有:** React 组件,数字按钮 + 前后箭头 + per-page select

**精装:纯 HTML(配合零 JS 公共页面)**

```
← 1 2 ... 5 6 [7] 8 9 ... 20 →        20 ▾
  ← accent 下划线标记当前页              ← per-page 下拉
```

```html
<nav class="pagination">
  <a href="?page=6" rel="prev" class="page-arrow">←</a>
  <a href="?page=1" class="page-num">1</a>
  <span class="page-ellipsis">...</span>
  <a href="?page=7" class="page-num active">7</a>
  <a href="?page=8" class="page-num">8</a>
  <span class="page-ellipsis">...</span>
  <a href="?page=20" class="page-num">20</a>
  <a href="?page=8" rel="next" class="page-arrow">→</a>
  <select class="per-page-select" onchange="...">
    <option>20</option><option>40</option><option>100</option>
  </select>
</nav>
```

当前页用 accent 下划线(同 filter-chip),非按钮背景填充。与整个设计系统的"下划线即选中"语言一致。

### 6.5 搜索框(SearchBar)

**现有:** React 组件,debounced autocomplete

**精装:原生 input + vanilla JS autocomplete**

导航中的搜索框:
```html
<input type="search" placeholder="搜索标签..." class="nav-search"
  onfocus="this.dataset.focused='1'" onblur="..."
  oninput="debouncedAutocomplete(this.value)">
<div class="search-suggestions" hidden>
  <!-- vanilla JS 填充 -->
</div>
```

Autocomplete 建议项设计:
```
┃ ●hatsune_miku  初音未来      1,234
┃ ●saber        阿尔托利亚       892
┃ ●1girl                         4521
   ↑ 分类色竖条  ↑ 翻译(hover显示)  ↑ 计数
```

与 TagBadge 设计语言一致——复用同一组件视觉规则,保持系统统一。

---

## 七、动画系统

### 7.1 动画词典(给每个元素"性格")

| 元素 | 入场动画 | 时长 | 缓动 |
|---|---|---|---|
| 图片卡片 | blurReveal(模糊→清晰) | 0.6s | ease-out |
| 页面标题 | maskWipe(左→右揭开) | 0.8s | ease-out |
| 计数数字 | countUp(上滑+淡入) | 0.4s | ease-out |
| 标签徽章 | fadeInPlace(原地淡入) | 0.3s | ease-out |
| 搜索建议 | dropIn(从上滑入) | 0.2s | ease-out |
| Modal | zoomIn(缩放+淡入) | 0.3s | ease-out |
| 导航栏收缩 | slideUp(顶部滑入) | 0.3s | ease-out |
| 分页器 | 无(HTML 直出) | — | — |
| 公告横幅 | expandDown(高度展开) | 0.35s | ease-out |

**原则:** 动画有叙事顺序——图片先聚焦(0.6s),然后文字揭示(0.8s,延迟 0.2s 启动),最后数字和标签淡入(延迟 0.4s)。用户感知到"图片先到,信息后到"的节奏。

### 7.2 Hover 微交互

| 元素 | hover 行为 |
|---|---|
| 图片卡片 | 浮起 2px + shadow + 圆角微张(4px→8px) |
| 标签徽章 | 文字变分类色 + 翻译出现 |
| 筛选器 | 文字变 accent + 下划线半显 |
| 主要按钮 | 上浮 1px + accent glow |
| 搜索建议 | 背景变 accent-subtle + 左侧分类色条加粗 |

### 7.3 滚动交互

**导航栏收缩:** 滚动 >100px 后,导航栏从"完整版"(logo + 搜索 + 菜单)收缩为"紧凑版"(小 logo + 搜索 + ...),高度从 56px → 44px。CSS transition 0.3s。

**图片懒加载触发:** `loading="lazy"` + `decoding="async"`(现有)。精装后增加 IntersectionObserver 触发 LQIP → preview 的升级加载(仅视口内加载 preview,视口外只显示 LQIP)。

---

## 八、移动端适配

### 8.1 底部 Tab Bar

**现有:** 顶部导航 + 移动菜单按钮

**精装:底部 Tab Bar(画廊型 App 标准模式)**

```
┌─────────────────────────────┐
│                             │
│         (内容区)             │
│                             │
│                             │
├─────────────────────────────┤
│  🏠      🔍      🎲      ⚙️  │  ← 底部 fixed tab bar
│  画廊   搜索    随机    菜单  │
└─────────────────────────────┘
```

- 画廊(首页)
- 搜索
- 随机
- 菜单(admin/登录/主题/强调色)

底部 tab bar 用 `env(safe-area-inset-bottom)` 适配 notched 设备。顶部导航仅保留 logo(极简)。

**不改变的核心:** 所有页面内容不变,只是导航方式从"顶部汉堡菜单"变为"底部 tab bar"——更符合移动端单手操作。

### 8.2 移动端详情页

图片全宽,标题/来源/评级在图片下方。标签区折叠为手风琴:

```
┌─────────────────────────────┐
│  ← 返回                     │
├─────────────────────────────┤
│                             │
│      (全宽图片)              │
│                             │
├─────────────────────────────┤
│  作品标题                    │
│  Pixiv · 1920×1080          │
│  [公开]  [查看原图]          │
├─────────────────────────────┤
│  ▼ 标签 (12)                │  ← 点击展开
│    ┃作品  fate/grand_order  │
│    ┃角色  saber ...          │
│    ...                       │
├─────────────────────────────┤
│  ▼ 信息                      │  ← 点击展开
│    尺寸  1920×1080           │
│    大小  2.3MB               │
│    ...                       │
└─────────────────────────────┘
```

### 8.3 移动端画廊

masonry 列数:2 列(现有)。gap 收窄到 4px。图片无 border 无 radius,紧贴屏幕边缘——最大化图片显示面积。

---

## 九、实现策略

### 9.1 渐进式改造顺序

这个 theme 不需要一次性重写,可以按"装修工序"逐步进行:

**工序 1:基层处理(改 CSS 变量,零结构改动)**
- 色彩微调(环境色基调、纸白/墨色)
- 字号节奏调整
- 间距节奏调整
- 卡片去装裱(border→none, radius→4px, shadow→hover only)

→ 这一步完成后,视觉已有显著变化,但 HTML 结构完全不变

**工序 2:动画系统(改 keyframes + animation 属性)**
- blurReveal 替代 cardIn
- maskWipe 用于标题
- countUp 用于数字
- 下划线 filter-chip 替代药丸 pill

→ 仍是纯 CSS 改动,零 JS

**工序 3:组件视觉升级(改组件 HTML/CSS)**
- TagBadge 加分类色竖条
- Pagination 改下划线样式
- Button 三层视觉层级
- 搜索框样式升级

→ HTML 微调,仍可保持 Astro 组件结构

**工序 4:布局重构(改页面结构)**
- 详情页三栏→沉浸式堆叠
- 导航极简 + "..." 菜单
- 首页 featuring 大图
- 标签页表格→星座图
- 搜索页探索界面

→ 这一步改动最大,需要重写页面 layout

**工序 5:交互增强(加 vanilla JS)**
- LQIP 渐进加载(sidecar 配合)
- Modal pan/zoom
- 键盘导航
- 滚动位置记忆
- 移动端底部 tab bar
- 搜索最近历史

**工序 6:字体引入**
- 展示字体 @font-face(woof2 自托管)
- 标题/标签应用展示字体

### 9.2 与 架构的关系

这份 theme 设计稿**框架无关**——它定义的是 CSS 变量、HTML 语义结构、动画词典、组件视觉规则。无论用 Nuxt/Nitro(v0.7.0/v0.7.0+)还是其他框架,这套设计语言都直接适用。

在 (Nuxt) 架构上可以先做工序 1-3(纯 CSS/组件改动),验证视觉效果。工序 4-6 的结构改动可以随迭代逐步进行。

### 9.3 设计 Token 清单

所有设计决策浓缩为 CSS 变量,作为 theme 的"配置文件":

```css
:root {
  /* === 环境色 === */
  --color-dark-bg: oklch(13% 0.012 270);      /* 微暖墨色 */
  --color-light-bg: oklch(98.5% 0.004 80);    /* 微暖纸白 */

  /* === 字体 === */
  --font-display: "HarmonyOS Sans", "Source Han Sans", system-ui, sans-serif;
  --font-body: system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;

  /* === 字号 === */
  --font-size-display: clamp(1.75rem, 1.2rem + 2.8vw, 3rem);
  --font-size-title: clamp(1.125rem, 1rem + 0.6vw, 1.375rem);
  --font-size-body: 0.9375rem;
  --font-size-meta: 0.8125rem;
  --font-size-micro: 0.6875rem;

  /* === 间距 === */
  --space-page-top: 2rem;
  --space-section: 3rem;
  --space-grid-gap: 0.5rem;

  /* === 圆角 === */
  --radius-image: 4px;       /* 图片卡片 */
  --radius-button: 2px;      /* 按钮 */
  --radius-chip: 0;          /* 筛选器(下划线风格,无圆角) */
  --radius-modal: 12px;      /* modal */

  /* === 动画 === */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-instant: 0.15s;
  --duration-fast: 0.25s;
  --duration-normal: 0.4s;
  --duration-slow: 0.6s;
  --duration-display: 0.8s;  /* 标题揭开动画 */

  /* === 选中态 === */
  /* 全局统一:下划线即选中,无实心背景填充 */
  --selection-indicator: 2px solid var(--accent-color);
}
```
