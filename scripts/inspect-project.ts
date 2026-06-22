const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN env var. Export a GitHub token before running this script.");
  process.exit(1);
}

async function main() {
  const query = `
    query {
      organization(login: "Grupo-Vannuchi") {
        projectV2(number: 1) {
          id
          title
          fields(first: 50) {
            nodes {
              __typename
              ... on ProjectV2Field {
                id
                name
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Antigravity-Agent"
    },
    body: JSON.stringify({ query }),
  });

  const result = (await response.json()) as {
    data?: { organization: { projectV2: { id: string; title: string; fields: { nodes: unknown[] } } } };
    errors?: unknown;
  };
  if (result.errors || !result.data) {
    console.error("GraphQL errors:", JSON.stringify(result.errors, null, 2));
    return;
  }

  const project = result.data.organization.projectV2;
  console.log("Project Title:", project.title);
  console.log("Project ID:", project.id);
  console.log("Project Fields:\n", JSON.stringify(project.fields.nodes, null, 2));
}

main().catch(console.error);
