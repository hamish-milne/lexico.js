import "mocha";
import {
  unary,
  convert,
  options,
  whitespace,
  repeat,
  float,
  parser,
} from "./index";
import assert from "assert";

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
  const jsonString = convert(['"', /(?:[^"\\]|(?:\\[bfnrt"\\]))*/, '"'], (x) =>
    x.replace(/\\[bfnrt"\\]/, (c) => escapeCodes[c[1]])
  );
  const comma = [whitespace, ",", whitespace];
  const jsonArray = [
    "[",
    whitespace,
    repeat(jsonValue, comma),
    whitespace,
    "]",
  ];
  const jsonProp = {
    key: options(float, jsonString),
    _: [whitespace, ":", whitespace],
    value: jsonValue,
  };
  const jsonDictionary = convert(
    ["{", whitespace, repeat(jsonProp, comma), "}", whitespace],
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

  it("should parse a combined object", function () {
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
