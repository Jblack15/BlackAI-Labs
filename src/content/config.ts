import { defineCollection, z } from 'astro:content';

const blog = defineCollection({ schema: z.object({
  title: z.string(), date: z.coerce.date(), author: z.string(), category: z.string(),
  featuredImage: z.string().default('/hero-illustration.png'), excerpt: z.string(),
}) });
const docs = defineCollection({ schema: z.object({ title: z.string(), updated: z.coerce.date(), description: z.string() }) });
export const collections = { blog, docs };
