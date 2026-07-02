import { pgEnum } from 'drizzle-orm/pg-core'

export const sourceSiteEnum = pgEnum('source_site', ['pixiv', 'twitter', 'danbooru', 'other'])
export const tagCategoryEnum = pgEnum('tag_category', ['artist', 'character', 'copyright', 'general', 'meta'])
export const ratingEnum = pgEnum('rating', ['safe', 'questionable', 'explicit'])
