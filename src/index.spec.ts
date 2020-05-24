import "mocha";
import {
  unary,
  convert,
  options,
  whitespace,
  repeat,
  float,
  parser,
  ignore,
  capture,
  nothing,
  not,
  eof,
  cut,
} from "./index";
import assert from "assert";

describe("Parser", function () {
  describe("cut", function () {
    it("stops evaluation of further options", function () {
      const p = parser(options(["1", cut, float], ["1notanumber"]));
      try {
        p({
          position: 0,
          text: "1notanumber",
        });
      } catch {
        return; // Success
      }
      throw null;
    });
  });
});

describe("JSON", function () {
  type jsonValueType =
    | number
    | null
    | string
    | boolean
    | jsonValueType[]
    | { [key: string]: jsonValueType; [key: number]: jsonValueType };
  const jsonValue = unary<jsonValueType>();
  const jsonNull = convert("null", () => null as null);
  const jsonBool = convert(options("true", "false"), Boolean);
  const escapeCodes: { [key: string]: string } = {
    "\\": "\\",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    '"': '"',
  };
  const jsonString = convert(
    ['"', capture(/(?:[^"\\]|(?:\\[bfnrt"\\]))*/), '"'],
    (x) => x.replace(/\\[bfnrt"\\]/, (c) => escapeCodes[c[1]])
  );
  const comma = /\s*,\s*/;
  const jsonArray = [ignore(/\[\s*/), repeat(jsonValue, comma), ignore(/\s*]/)];
  const jsonProp = {
    key: jsonString,
    _: ignore(/\s*:\s*/),
    value: jsonValue,
  };
  const jsonDictionary = convert(
    [ignore(/{\s*/), repeat(jsonProp, comma), ignore(/}\s*/)],
    (pairs) => {
      const retval: { [key: string]: any; [key: number]: any } = {};
      for (const pair of pairs) {
        retval[pair.key] = pair.value;
      }
      return retval;
    }
  );
  jsonValue(
    options(jsonDictionary, jsonArray, jsonString, jsonNull, jsonBool, float)
  );
  const jsonDocument = parser([whitespace, jsonValue, whitespace]);

  it("parses a combined object", function () {
    const testObj = {
      users: [
        {
          email: "hamish@test.com",
          user_id: 123456789,
          username: "hamish",
          online: true,
        },
        {
          email: "bob@test.com",
          user_id: 246810,
          username: "bob",
          online: true,
        },
        null,
      ],
    };
    const text = JSON.stringify(testObj);
    const result = jsonDocument({
      text: text,
      position: 0,
    });
    assert.equal(JSON.stringify(result), text);
  });
});

const expr = unary<number>();
function op(opr: string, fn: (a: number, b: number) => number) {
  return convert(
    {
      lhs: expr,
      _: opr,
      rhs: expr,
    },
    (x) => fn(x.lhs, x.rhs)
  );
}
expr(
  options(
    op("-", (a, b) => a - b),
    op("+", (a, b) => a + b),
    op("*", (a, b) => a * b),
    op("/", (a, b) => a / b),
    op("^", (a, b) => a ^ b),
    parser(["(", expr, ")"]),
    float
  )
);

type ValueExpr = { start: string; ops: (ElementExpr[] | string)[] };
type PortList = { name: string; hint?: ElementExpr }[];
type LambdaExpr = { args: PortList; body: ElementExpr };
type ElementExpr = ValueExpr | LambdaExpr;
type ElementDecl = ElementFuncType | ElementFunc | ElementNamespace;
type ElementScope = ElementDecl[];
type ElementNamespace = { type: "struct" | "namespace"; body: ElementScope };
type ElementFuncType = {
  type: "interface" | "intrinsic";
  name: string;
  args?: PortList;
  hint?: ElementExpr;
};
type ElementFunc = {
  name: string;
  args?: PortList;
  hint?: ElementExpr;
  body: ElementScope | ElementExpr;
};
const identifier = [not(options("struct", "namespace")), capture(/\w+/)];
const expression = unary<ElementExpr>();
const callExpression = [/\(\s*/, repeat(expression, /\s*,\s*/), /\s*\(/];
const memberExpression = [/\.\s*/, identifier];
const typeHint = options([/\s*:/, expression], nothing);
const portList = repeat(
  {
    name: identifier,
    hint: typeHint,
  },
  /\s*,\s*/
);
expression(
  options(
    {
      start: identifier,
      _: whitespace,
      ops: repeat(options(callExpression, memberExpression), whitespace),
    },
    {
      _: /_\(\s*/,
      args: portList,
      __: /\s*=>\s*/,
      body: expression,
    }
  )
);
const declaration = unary<ElementDecl>();
const scope = [/{\s*/, repeat(declaration, whitespace), /\s*}/];
declaration(
  options(
    {
      name: identifier,
      _: whitespace,
      args: options(portList, nothing),
      hint: typeHint,
      __: whitespace,
      body: options([/=\s*/, expression, /\s*;/], scope),
    },
    {
      type: options("struct", "namespace"),
      _: whitespace,
      name: identifier,
      __: whitespace,
      body: scope,
    }
  )
);
const elementFile = parser([
  whitespace,
  repeat(declaration, whitespace),
  whitespace,
  eof,
]);
