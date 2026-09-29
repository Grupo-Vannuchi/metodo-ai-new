import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { brPhoneVariants } from "../identity";

describe("brPhoneVariants (9º dígito do celular brasileiro)", () => {
  test("13 dígitos (com o 9) → também a forma de 12 sem o 9", () =>
    assert.deepEqual(brPhoneVariants("5511977770001"), ["5511977770001", "551177770001"]));

  test("12 dígitos de celular (6–9) → também a forma de 13 com o 9", () =>
    assert.deepEqual(brPhoneVariants("551177770001"), ["551177770001", "5511977770001"]));

  test("12 dígitos de fixo (2–5) → só ele mesmo", () =>
    assert.deepEqual(brPhoneVariants("551133334444"), ["551133334444"]));

  test("número de fora do Brasil → só ele mesmo", () =>
    assert.deepEqual(brPhoneVariants("15550783881"), ["15550783881"]));

  test("13 dígitos cujo 5º dígito não é 9 → só ele mesmo", () =>
    assert.deepEqual(brPhoneVariants("5511877770001"), ["5511877770001"]));

  test("formato estranho → só ele mesmo", () => assert.deepEqual(brPhoneVariants("55119"), ["55119"]));
});
