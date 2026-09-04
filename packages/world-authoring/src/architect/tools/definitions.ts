import type { ToolDefinition } from "@chatverse/core";

const CHARACTER_CARD_SCHEMA = {
  type: "object",
  required: ["name", "description", "personality", "scenario", "messageExample"],
  properties: {
    name: { type: "string", description: "角色显示名" },
    description: { type: "string", description: "角色身份与外在定位" },
    personality: { type: "string", description: "性格、判断方式和说话方式" },
    scenario: { type: "string", description: "角色自己的处境与已知背景，不是全量世界书" },
    messageExample: { type: "string", description: "至少一段能校准口吻的对话示例" },
    instructions: { type: "string", description: "角色专属行为边界与补充指令" },
  },
} as const;

const SCENE_CARD_SCHEMA = {
  type: "object",
  required: ["groupName", "topic", "atmosphere"],
  properties: {
    groupName: { type: "string" },
    topic: { type: "string" },
    atmosphere: { type: "string" },
    state: {
      type: "string",
      enum: ["flowing", "heated", "winding_down", "idle", "paused"],
    },
    rules: { type: "array", items: { type: "string" } },
  },
} as const;

const PLAYER_CHARACTER_CARD_SCHEMA = {
  type: "object",
  required: [
    "name",
    "identity",
    "background",
    "personality",
    "appearance",
    "speechStyle",
    "boundaries",
  ],
  properties: {
    name: { type: "string", description: "玩家在世界中的姓名" },
    identity: { type: "string", description: "玩家公开身份与社会位置" },
    background: { type: "string", description: "其他角色可以知道的公开背景" },
    personality: { type: "string", description: "玩家希望代理时遵循的性格倾向" },
    appearance: { type: "string", description: "可观察外貌" },
    speechStyle: { type: "string", description: "玩家代理的表达方式" },
    boundaries: { type: "string", description: "玩家身份、能力和行为边界" },
  },
} as const;

const DRAFT_PLAYER_SCHEMA = {
  type: "object",
  description: "world_story 必须提供完整玩家角色卡；profile 是简要公开身份，playerCard 是演出和玩家代理使用的完整角色卡。",
  required: ["mode", "profile", "playerCard"],
  properties: {
    id: { type: "string" },
    mode: { type: "string", enum: ["participant", "observer", "director"] },
    profile: { type: "object" },
    playerCard: PLAYER_CHARACTER_CARD_SCHEMA,
  },
} as const;

const DRAFT_ACTOR_SCHEMA = {
  type: "object",
  description: "一次只保存一名角色。新增时 id 使用简短稳定别名，后续关系、Context 和章节继续引用该 id。",
  required: ["id", "role", "card"],
  properties: {
    id: { type: "string" },
    role: { type: "string", enum: ["lead", "support"] },
    background: { type: "string" },
    card: CHARACTER_CARD_SCHEMA,
  },
} as const;

const DRAFT_RELATION_SCHEMA = {
  type: "object",
  required: ["fromActorId", "toActorId", "description"],
  properties: {
    id: { type: "string" },
    fromActorId: { type: "string" },
    toActorId: { type: "string" },
    description: { type: "string" },
  },
} as const;

const DRAFT_CONTEXT_SCHEMA = {
  type: "object",
  description: "第一版更新已有单一 Context；必须提供 name、完整 scene 和 opening。",
  required: ["id", "name", "scene", "opening"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    actorIds: { type: "array", items: { type: "string" } },
    scene: SCENE_CARD_SCHEMA,
    opening: { type: "string" },
    presentation: {
      type: "object",
      description: "可选演出配置；world_story 未提供时 Host 会生成默认 Galgame 配置。",
      properties: {
        kind: { type: "string", enum: ["galgame"] },
        playerActorId: { type: "string" },
        artDirection: { type: "string" },
        backgroundGeneration: { type: "string", enum: ["auto"] },
        acknowledgement: { type: "string", enum: ["required"] },
      },
    },
  },
} as const;

const DRAFT_CHAPTER_SCHEMA = {
  type: "object",
  description: "一次只保存一条足以承载 4-8 个 Beat 的长期章节计划，并用已有稳定 ID 引用 Actor 和 Context。",
  required: ["id", "title", "treatment", "targetOutcome", "status", "actorIds", "contextIds"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    treatment: { type: "string", description: "约 600-1500 字的章节纲要，只写局面、矛盾、力量、约束和允许的推进空间，不写固定对白或逐幕流程。" },
    targetOutcome: { type: "string", description: "章节唯一可观察、能改变世界状态的阶段性结果，必须足以承载多个 Beat。" },
    status: { type: "string", enum: ["active", "queued"] },
    actorIds: { type: "array", items: { type: "string" } },
    contextIds: { type: "array", items: { type: "string" } },
  },
} as const;

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_draft",
      description: "按需查看草稿索引或指定部分。sections 可包含 metadata,lore,player,actors,relations,contexts,chapters,sources,runtime。",
      parameters: {
        type: "object",
        properties: {
          sections: { type: "array", items: { type: "string" } },
          ids: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_source_materials",
      description: "查看只读资料目录，或搜索关键词并返回带行号的命中片段。原始资料不可修改。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "可选关键词；省略时只返回文档目录。" },
          bundleIds: { type: "array", items: { type: "string" } },
          documentIds: { type: "array", items: { type: "string" } },
          limit: { type: "integer", minimum: 1, maximum: 12 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_source_material",
      description: "按行读取一篇已定位的 Markdown 资料。先搜索或查看目录，再只读取当前工作需要的范围。",
      parameters: {
        type: "object",
        required: ["documentId", "startLine", "endLine"],
        properties: {
          documentId: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_source_documents",
      description: "创建可检索 Markdown 资料源，或为 origin=architect 的资料源生成新修订。不能修改用户上传原文。",
      parameters: {
        type: "object",
        required: ["name", "documents"],
        properties: {
          bundleId: { type: "string", description: "修订 Agent 资料源时填写；新建时省略。" },
          baseRevision: { type: "integer" },
          name: { type: "string" },
          description: { type: "string" },
          documents: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              required: ["path", "title", "content"],
              properties: {
                path: { type: "string" },
                title: { type: "string" },
                content: { type: "string", description: "完整 Markdown 正文。修订时提交该资料源的完整文档集。" },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_authoring_plan",
      description: "可选地为确实较长的创作任务建立轻量分阶段计划。普通对话和局部修改不要调用；如果用户改变方向，可以替换现有计划。",
      parameters: {
        type: "object",
        required: ["goal", "items"],
        properties: {
          goal: { type: "string" },
          items: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              required: ["title", "scope"],
              properties: {
                title: { type: "string" },
                scope: {
                  type: "string",
                  enum: ["foundation", "actors", "relations", "context", "chapters", "polish"],
                },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_world_core",
      description: "更新世界名称、简介、前提或核心规则。只提交本次确实需要修改的字段。",
      parameters: {
        type: "object",
        properties: {
          metadata: { type: "object" },
          premise: { type: "string" },
          lore: { type: "object" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_player_card",
      description: "新增或更新完整玩家角色卡。一次只保存玩家这一项。",
      parameters: { type: "object", required: ["player"], properties: { player: DRAFT_PLAYER_SCHEMA } },
    },
  },
  {
    type: "function",
    function: {
      name: "save_actor",
      description: "新增或更新一名角色。完整角色卡一次只写一名。",
      parameters: { type: "object", required: ["actor"], properties: { actor: DRAFT_ACTOR_SCHEMA } },
    },
  },
  {
    type: "function",
    function: {
      name: "save_relations",
      description: "新增或更新一小组有向角色关系。Actor 必须已经存在；只使用 inspect_draft 或之前写入回执 idMappings 中的 actualId，不要用角色名或自行猜测的 ID。",
      parameters: {
        type: "object",
        required: ["relations"],
        properties: {
          relations: { type: "array", minItems: 1, maxItems: 6, items: DRAFT_RELATION_SCHEMA },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_context",
      description: "新增或更新当前唯一 Context、场景与开场。一次只写一个 Context。",
      parameters: { type: "object", required: ["context"], properties: { context: DRAFT_CONTEXT_SCHEMA } },
    },
  },
  {
    type: "function",
    function: {
      name: "save_chapter",
      description: "新增或更新一条长期章节计划。一次只写一条；章节应自然承载约 4-8 个 Beat。",
      parameters: { type: "object", required: ["chapter"], properties: { chapter: DRAFT_CHAPTER_SCHEMA } },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_draft_entities",
      description: "删除玩家、角色、关系或章节。先解除引用，再删除被引用实体。",
      parameters: {
        type: "object",
        properties: {
          removePlayer: { type: "boolean" },
          actorIds: { type: "array", items: { type: "string" }, maxItems: 6 },
          relationIds: { type: "array", items: { type: "string" }, maxItems: 12 },
          chapterIds: { type: "array", items: { type: "string" }, maxItems: 6 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_runtime_profile",
      description: "设置草稿运行模式。",
      parameters: {
        type: "object",
        required: ["runtimeProfile"],
        properties: { runtimeProfile: { type: "string", enum: ["world_story", "group_chat"] } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_draft",
      description: "校验当前工作草稿的结构、引用和最低可运行性。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "结束本轮创作。summary 是给用户看的简短摘要，questions 最多三个。",
      parameters: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: { type: "string" },
          questions: { type: "array", maxItems: 3, items: { type: "string" } },
        },
      },
    },
  },
];

const RESEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "research_web",
    description: "联网检索当前创作确实需要的公开资料。只用于历史、现实、教育、地域文化或时效信息，不用于给原创设定增加装饰。",
    parameters: {
      type: "object",
      required: ["query", "purpose"],
      properties: {
        query: { type: "string", description: "简短、明确的公开检索问题，最多 300 字。" },
        purpose: { type: "string", description: "说明这些资料将用于哪个创作阶段。" },
      },
    },
  },
};

export function worldArchitectTools(researchEnabled: boolean): ToolDefinition[] {
  return researchEnabled ? [...TOOLS, RESEARCH_TOOL] : TOOLS;
}
