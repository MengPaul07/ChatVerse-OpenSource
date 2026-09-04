export type DocCategory = "start" | "concepts" | "reference" | "notes";

export type DocEntry = {
  slug: string;
  sourcePath: string;
  title: string;
  description: string;
  category: DocCategory;
  order: number;
  content: string;
};

type Frontmatter = Record<string, string>;

const markdownModules = import.meta.glob("../../../docs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const categoryLabels: Record<DocCategory, string> = {
  start: "开始使用",
  concepts: "核心概念",
  reference: "API 参考",
  notes: "工程记录",
};

const filenameMetadata: Record<string, Partial<Pick<DocEntry, "category" | "order" | "description">>> = {
  "getting-started": {
    category: "start",
    order: 1,
    description: "从第一个 World 开始，理解 ChatVerse 的运行方式。",
  },
  architecture: {
    category: "concepts",
    order: 2,
    description: "从定义、运行时到事件流，建立完整的系统心智模型。",
  },
  "product-doc": {
    category: "concepts",
    order: 3,
    description: "了解产品定位、用户路径与可扩展的世界模型。",
  },
  api: {
    category: "reference",
    order: 10,
    description: "公开的 Core API、生命周期、输入输出和快照接口。",
  },
  deployment: {
    category: "start",
    order: 4,
    description: "了解 chatverse.fun 与 world.chatverse.fun 的线上拓扑、发布和回滚流程。",
  },
  "world-source": {
    category: "concepts",
    order: 5,
    description: "把长篇资料编译成可检索、可追溯的 World Source。",
  },
  "world-benchmark": {
    category: "reference",
    order: 12,
    description: "运行 CVWB 场景、确定性契约与可选 Judge 评分。",
  },
  "world-server-live-e2e": {
    category: "reference",
    order: 11,
    description: "用真实服务验证 World Server 的端到端运行链路。",
  },
  "prompt-tuning-log": {
    category: "notes",
    order: 21,
    description: "Director 与角色提示词调优过程中的实验记录。",
  },
};

export const docCategoryLabels = categoryLabels;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/-+/g, "-");
}

function readFrontmatter(source: string) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { attributes: {} as Frontmatter, content: source };
  }

  const attributes: Frontmatter = {};
  match[1].split("\n").forEach((line) => {
    const separator = line.indexOf(":");
    if (separator === -1) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value) attributes[key] = value;
  });

  return { attributes, content: source.slice(match[0].length) };
}

function fileNameFromPath(path: string) {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

function titleFromContent(content: string, fallback: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading?.replace(/[`*_]/g, "") || fallback;
}

function descriptionFromContent(content: string) {
  const paragraph = content
    .replace(/^#\s+.+$/m, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/[`*_>#-]/g, "").replace(/\s+/g, " ").trim())
    .find((part) => part.length > 20);
  return paragraph?.slice(0, 136) || "ChatVerse 的设计、使用与运行记录。";
}

function categoryFromSlug(slug: string): DocCategory {
  if (slug === "api" || slug.includes("e2e")) return "reference";
  if (slug.includes("product") || slug.includes("architecture")) return "concepts";
  if (slug.includes("getting") || slug.includes("start")) return "start";
  return "notes";
}

export const docs: DocEntry[] = Object.entries(markdownModules)
  .map(([sourcePath, rawSource]) => {
    const fileName = fileNameFromPath(sourcePath);
    const slug = slugify(fileName);
    const { attributes, content } = readFrontmatter(rawSource);
    const metadata = filenameMetadata[slug] ?? {};
    const category = (attributes.category as DocCategory | undefined) ?? metadata.category ?? categoryFromSlug(slug);
    const order = Number(attributes.order ?? metadata.order ?? 100);

    return {
      slug,
      sourcePath,
      title: attributes.title ?? titleFromContent(content, fileName.replace(/[-_]+/g, " ")),
      description: attributes.description ?? metadata.description ?? descriptionFromContent(content),
      category,
      order: Number.isFinite(order) ? order : 100,
      content,
    } satisfies DocEntry;
  })
  .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "zh-CN"));

export function findDoc(slug?: string) {
  return docs.find((doc) => doc.slug === slug);
}

export function docsByCategory(category: DocCategory) {
  return docs.filter((doc) => doc.category === category);
}
