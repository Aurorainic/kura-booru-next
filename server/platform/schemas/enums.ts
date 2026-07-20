/**
 * zod 枚举单点定义（ADR-0004 §1）：从 Drizzle pgEnum 派生，消灭审计 §7.2 确认的
 * 4 处硬编码重复（web-import.post.ts / posts/[id].patch.ts / admin/tags/[id].patch.ts /
 * pipeline.ts ×2）。PG enum 是唯一真源，此处只是它的 zod 投影。
 */
import { z } from 'zod'
import { ratingEnum, sourceSiteEnum, tagCategoryEnum } from '../../schema/enums'

export const zRating = z.enum(ratingEnum.enumValues)
export const zSourceSite = z.enum(sourceSiteEnum.enumValues)
export const zTagCategory = z.enum(tagCategoryEnum.enumValues)

export type Rating = z.infer<typeof zRating>
export type SourceSite = z.infer<typeof zSourceSite>
export type TagCategory = z.infer<typeof zTagCategory>
