import { readFileSync } from "fs";

const TOKEN = "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";
const PROJECT_ID = "PVT_kwDOEVB4iM4BaZqQ";
const STATUS_FIELD_ID = "PVTSSF_lADOEVB4iM4BaZqQzhVRjBo";
const AREA_FIELD_ID = "PVTSSF_lADOEVB4iM4BaZqQzhV02l4";

const STATUS_OPTIONS: Record<string, string> = {
  "Backlog": "819dfdb9",
  "To Do": "f75ad846",
  "In Progress": "47fc9ee4",
  "Blocked": "afad9c38",
  "Done": "b2784f0e",
  "Approved": "98236657"
};

const AREA_OPTIONS: Record<string, string> = {
  "CRE": "5f76d7d9",
  "CRX": "5d5362ef",
  "IMP": "27dd6d23",
  "RMV": "6a463ae1",
  "UPD": "23b1a098"
};

interface TaskInput {
  title: string;       // Action verb + task, without prefix since script adds it, or full title
  area: "CRE" | "CRX" | "IMP" | "RMV" | "UPD";
  status: "Backlog" | "To Do" | "In Progress" | "Blocked" | "Done" | "Approved";
  description: string;
  steps?: {
    estruturar?: string;
    testar?: string;
    implementar?: string;
    validar?: string;
  } | string[]; // can be custom or standard list
  requirements?: string;
  comments?: string;
}

async function graphql(query: string, variables: any) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Antigravity-Agent"
    },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json() as any;
  if (result.errors) {
    throw new Error("GraphQL Error: " + JSON.stringify(result.errors, null, 2));
  }
  return result.data;
}

async function main() {
  const argFile = process.argv[2];
  if (!argFile) {
    console.error("Usage: tsx scripts/create-project-task.ts <path_to_json_file>");
    process.exit(1);
  }

  const rawData = readFileSync(argFile, "utf-8");
  const task: TaskInput = JSON.parse(rawData);

  // Ensure title has the correct prefix
  let finalTitle = task.title;
  const prefix = `[${task.area}]`;
  if (!finalTitle.startsWith(prefix)) {
    finalTitle = `${prefix} - ${finalTitle.replace(/^\[[A-Z]{3}\]\s*-\s*/, "")}`;
  }

  // Format body description
  let body = `## Descrição da task\n${task.description}\n\n`;
  
  body += `## Divisão de passos\n`;
  if (Array.isArray(task.steps)) {
    for (const step of task.steps) {
      body += `- [ ] ${step}\n`;
    }
  } else if (task.steps) {
    body += `- [ ] Estruturar: ${task.steps.estruturar || ""}\n`;
    body += `- [ ] Testar: ${task.steps.testar || ""}\n`;
    body += `- [ ] Implementar: ${task.steps.implementar || ""}\n`;
    body += `- [ ] Validar: ${task.steps.validar || ""}\n`;
  } else {
    body += `- [ ] Estruturar\n`;
    body += `- [ ] Testar\n`;
    body += `- [ ] Implementar\n`;
    body += `- [ ] Validar\n`;
  }

  if (task.requirements) {
    body += `\n## Pontos adicionais sobre a task\n${task.requirements}\n`;
  } else {
    body += `\n## Pontos adicionais sobre a task\nNenhum requisito ou restrição adicional.\n`;
  }

  if (task.comments) {
    body += `\n## Comentários sobre os passos\n${task.comments}\n`;
  } else {
    body += `\n## Comentários sobre os passos\n*(Preenchido conforme a execução)*\n`;
  }

  console.log(`Creating task: "${finalTitle}"...`);

  // 1. Add draft issue
  const addMutation = `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: {projectId: $projectId, title: $title, body: $body}) {
        projectItem {
          id
        }
      }
    }
  `;
  const addResult = await graphql(addMutation, {
    projectId: PROJECT_ID,
    title: finalTitle,
    body: body
  });

  const itemId = addResult.addProjectV2DraftIssue.projectItem.id;
  console.log(`Draft issue created with ID: ${itemId}`);

  // 2. Set Status
  const statusOptionId = STATUS_OPTIONS[task.status];
  if (!statusOptionId) {
    throw new Error(`Invalid status: ${task.status}`);
  }
  const updateStatusMutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `;
  await graphql(updateStatusMutation, {
    projectId: PROJECT_ID,
    itemId: itemId,
    fieldId: STATUS_FIELD_ID,
    optionId: statusOptionId
  });
  console.log(`Status set to "${task.status}"`);

  // 3. Set Area
  const areaOptionId = AREA_OPTIONS[task.area];
  if (!areaOptionId) {
    throw new Error(`Invalid area: ${task.area}`);
  }
  await graphql(updateStatusMutation, {
    projectId: PROJECT_ID,
    itemId: itemId,
    fieldId: AREA_FIELD_ID,
    optionId: areaOptionId
  });
  console.log(`Area set to "${task.area}"`);

  console.log(`\n✓ Task successfully created on the board!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
