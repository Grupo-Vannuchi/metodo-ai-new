import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplateComponents,
  defaultMapping,
  mappingIsComplete,
  renderTemplateText,
  resolveParamValues,
  suggestValues,
  templateStatusFromEvent,
  templateVariables,
  toTemplateDef,
  toTemplateOption,
  unsupportedReason,
  type TemplateDef,
} from "../template-params";

const positional: TemplateDef = {
  name: "retorno_orcamento",
  language: "pt_BR",
  parameterFormat: "POSITIONAL",
  components: [
    { type: "HEADER", format: "TEXT", text: "Orçamento {{1}}" },
    { type: "BODY", text: "Olá {{1}}, seu orçamento da {{2}} está pronto. Código {{1}}." },
    { type: "FOOTER", text: "Responda PARAR para sair." },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Parar de receber" }] },
  ],
};

const named: TemplateDef = {
  name: "boas_vindas",
  language: "pt_BR",
  parameterFormat: "NAMED",
  components: [{ type: "BODY", text: "Oi {{first_name}}! Aqui é da {{company_name}}." }],
};

describe("templateVariables", () => {
  test("posicional: cabeçalho e corpo separados, sem repetir, em ordem numérica", () => {
    assert.deepEqual(templateVariables(positional), [
      { id: "header.1", key: "1", component: "header" },
      { id: "body.1", key: "1", component: "body" },
      { id: "body.2", key: "2", component: "body" },
    ]);
  });

  test("nomeado: ordem de aparição", () => {
    assert.deepEqual(templateVariables(named).map((v) => v.id), ["body.first_name", "body.company_name"]);
  });

  test("cabeçalho de imagem não tem variável de texto", () => {
    const def: TemplateDef = { ...named, components: [{ type: "HEADER", format: "IMAGE" }, ...named.components] };
    assert.deepEqual(templateVariables(def).map((v) => v.id), ["body.first_name", "body.company_name"]);
  });
});

describe("unsupportedReason", () => {
  test("texto + quick reply é suportado", () => assert.equal(unsupportedReason(positional), null));
  test("cabeçalho de imagem não é suportado", () =>
    assert.equal(unsupportedReason({ ...named, components: [{ type: "HEADER", format: "IMAGE" }] }), "media_header"));
  test("cabeçalho de localização não é suportado", () =>
    assert.equal(unsupportedReason({ ...named, components: [{ type: "HEADER", format: "LOCATION" }] }), "location_header"));
  test("botão de URL com variável não é suportado", () =>
    assert.equal(
      unsupportedReason({
        ...named,
        components: [{ type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.com/{{1}}" }] }],
      }),
      "button_variable",
    ));
  test("botão de copiar código não é suportado", () =>
    assert.equal(
      unsupportedReason({ ...named, components: [{ type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "Copiar" }] }] }),
      "button_variable",
    ));
});

describe("valores", () => {
  const vars = templateVariables(positional);

  test("resolve nome, empresa e fixo; vazio usa o reserva e depois '-'", () => {
    const values = resolveParamValues(
      vars,
      {
        "header.1": { source: "fixo", value: "#123" },
        "body.1": { source: "nome", value: "cliente" },
        "body.2": { source: "empresa" },
      },
      { nome: "", empresa: "" },
    );
    assert.deepEqual(values, { "header.1": "#123", "body.1": "cliente", "body.2": "-" });
  });

  test("componentes posicionais: sem parameter_name, na ordem", () => {
    assert.deepEqual(buildTemplateComponents(positional, { "header.1": "#9", "body.1": "Ana", "body.2": "ACME" }), [
      { type: "header", parameters: [{ type: "text", text: "#9" }] },
      { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "ACME" }] },
    ]);
  });

  test("componentes nomeados: com parameter_name", () => {
    assert.deepEqual(buildTemplateComponents(named, { "body.first_name": "Ana", "body.company_name": "ACME" }), [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana", parameter_name: "first_name" },
          { type: "text", text: "ACME", parameter_name: "company_name" },
        ],
      },
    ]);
  });

  test("modelo sem variáveis não gera componentes", () => {
    assert.deepEqual(buildTemplateComponents({ ...named, components: [{ type: "BODY", text: "Oi!" }] }, {}), []);
  });

  test("texto final junta cabeçalho, corpo e rodapé", () => {
    assert.equal(
      renderTemplateText(positional, { "header.1": "#9", "body.1": "Ana", "body.2": "ACME" }),
      "Orçamento #9\n\nOlá Ana, seu orçamento da ACME está pronto. Código Ana.\n\nResponda PARAR para sair.",
    );
  });

  test("variável sem valor fica visível na prévia", () => {
    assert.equal(renderTemplateText(named, { "body.first_name": "Ana" }), "Oi Ana! Aqui é da {{company_name}}.");
  });
});

describe("sugestões e mapeamento padrão", () => {
  test("sugere nome no {{1}} do corpo e em chaves de nome/empresa", () => {
    assert.deepEqual(suggestValues(templateVariables(positional), { nome: "Ana", empresa: "ACME" }), {
      "header.1": "",
      "body.1": "Ana",
      "body.2": "",
    });
    assert.deepEqual(suggestValues(templateVariables(named), { nome: "Ana", empresa: "ACME" }), {
      "body.first_name": "Ana",
      "body.company_name": "ACME",
    });
  });

  test("mapeamento padrão e completude", () => {
    const vars = templateVariables(named);
    const mapping = defaultMapping(vars);
    assert.deepEqual(mapping, {
      "body.first_name": { source: "nome", value: "cliente" },
      "body.company_name": { source: "empresa", value: "" },
    });
    assert.equal(mappingIsComplete(vars, mapping), true);
    assert.equal(mappingIsComplete(vars, { "body.first_name": { source: "fixo", value: " " } }), false);
  });
});

describe("templateStatusFromEvent (evento da Meta → status gravado)", () => {
  test("REINSTATED volta a APPROVED", () => assert.equal(templateStatusFromEvent("REINSTATED"), "APPROVED"));
  test("FLAGGED não muda o status (aviso de qualidade, modelo segue enviável)", () =>
    assert.equal(templateStatusFromEvent("FLAGGED"), null));
  test("IN_APPEAL e UNARCHIVED não mudam o status", () => {
    assert.equal(templateStatusFromEvent("IN_APPEAL"), null);
    assert.equal(templateStatusFromEvent("UNARCHIVED"), null);
  });
  test("PAUSED é gravado como está", () => assert.equal(templateStatusFromEvent("PAUSED"), "PAUSED"));
  test("status reais passam direto", () => {
    for (const s of [
      "APPROVED",
      "REJECTED",
      "PENDING",
      "DISABLED",
      "PENDING_DELETION",
      "DELETED",
      "ARCHIVED",
      "LOCKED",
      "LIMIT_EXCEEDED",
    ]) {
      assert.equal(templateStatusFromEvent(s), s);
    }
  });
  test("evento desconhecido não muda o status", () => assert.equal(templateStatusFromEvent("SOMETHING_NEW"), null));
});

describe("conversão das linhas do banco", () => {
  test("componentes inválidos viram lista vazia", () => {
    const def = toTemplateDef({ name: "x", language: "pt_BR", parameterFormat: "POSITIONAL", components: "lixo" });
    assert.deepEqual(def.components, []);
  });

  test("toTemplateOption calcula variáveis e suporte", () => {
    const opt = toTemplateOption({
      id: "t1",
      name: "boas_vindas",
      language: "pt_BR",
      category: "MARKETING",
      parameterFormat: "NAMED",
      components: named.components,
    });
    assert.equal(opt.unsupported, null);
    assert.equal(opt.variables.length, 2);
    assert.equal(opt.def.name, "boas_vindas");
  });
});
