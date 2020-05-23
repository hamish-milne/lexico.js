export type state = { text: string; position: number };

export type parser<T> = (state: state) => T;
export type spec = string | RegExp | parser<any> | objSpec | spec[];
type objSpec = { [key: string]: spec };
type punctuationKeys = "_" | "__" | "___" | "____" | "_____";
type resolveNoArray<T> = T extends parser<infer T2>
  ? T2
  : T extends RegExp
  ? string
  : T extends string
  ? undefined
  : T[keyof T] extends spec
  ? { [P in Exclude<keyof T, punctuationKeys>]: resolve<T[P]> }
  : never;
export type resolve<T> = T extends Array<infer T3>
  ? Exclude<resolveNoArray<T3>, undefined>
  : resolveNoArray<T>;

/**
 * Converts a value in the form of a 'specification' to a parser function.
 * This allows almost all parsers to be built using plain object syntax
 * The conversions are as follows:
 *   * String: punctuation->null
 *   * RegExp: regex->string
 *   * Array: sequence
 *   * Object: structure
 * @param spec The specification object to convert to a `parser`
 */
export function parser<TSpec extends spec>(
  spec: TSpec | undefined
): parser<resolve<TSpec>> {
  switch (typeof spec) {
    case "string":
      // assert resolve<TSpec> == some string literal
      return punctuation(spec) as parser<resolve<TSpec>>;
    case "function":
      // assert resolve<TSpec> == parser<T>
      return spec as parser<resolve<TSpec>>;
    case "object":
      if (spec === null) {
        return nothing as parser<resolve<TSpec>>;
      } else if (Array.isArray(spec)) {
        // assert resolve<TSpec> == T[]
        return sequence(spec) as parser<resolve<TSpec>>;
      } else if (spec instanceof RegExp) {
        // assert resolve<TSpec> == string
        return regex(spec) as parser<resolve<TSpec>>;
      } else {
        // assert resolve<TSpec> == {k:v}
        return structure(spec as objSpec) as parser<resolve<TSpec>>;
      }
    case "undefined":
      return nothing as parser<resolve<TSpec>>;
    default:
      throw Error("Argument error");
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function nothing(_: state): undefined {
  return undefined;
}

export function ignore<TSpec extends spec>(inner: TSpec): parser<undefined> {
  const cInner = parser(inner);
  return (state: state) => {
    cInner(state);
    return undefined;
  };
}

export const whitespace = ignore(/\s*/);

function rEscape(match: string) {
  return match.replace(/([^a-zA-Z0-9])/g, "\\$1");
}

function patternTest<T>(
  pattern: RegExp,
  success: T,
  advance: number
): parser<T> {
  return (state: state) => {
    pattern.lastIndex = state.position;
    if (pattern.test(state.text)) {
      state.position += advance;
      return success;
    } else {
      throw null;
    }
  };
}

export function punctuation<T extends string>(match: T): parser<undefined> {
  return patternTest(RegExp(rEscape(match), "y"), undefined, match.length);
}

export function literal<T extends string>(match: T): parser<T> {
  return patternTest(RegExp(rEscape(match), "y"), match, match.length);
}

export function char(chars: string): parser<null> {
  return patternTest(RegExp(`[${rEscape(chars)}]`, "y"), null, 1);
}

export function range(a: string, b: string): parser<null> {
  if (a.length != 1 || b.length != 1) {
    throw Error("String length must be 1");
  }
  return patternTest(RegExp(`^[${rEscape(a)}-${rEscape(b)}]`, "y"), null, 1);
}

export function repeat<T1 extends spec, T2 extends spec>(
  inner: T1,
  separator?: T2,
  max?: number,
  min?: number
): parser<resolve<T1>[]> {
  const cInner = parser(inner);
  const cSep = parser(separator);

  return (state: state) => {
    const list: resolve<T1>[] = [];
    const first = cInner(state);
    if (first !== undefined) {
      list.push(first);
    }
    let begin: number;
    do {
      begin = state.position;
      try {
        cSep(state);
        const item = cInner(state);
        if (item !== undefined) {
          list.push(item);
        }
      } catch (e) {
        if (e != null) {
          throw e;
        }
        state.position = begin;
      }
    } while (state.position > begin);
    return list;
  };
}

type resolveOptionsNoArray<T> = T extends parser<infer T2>
  ? T2
  : T extends RegExp
  ? string
  : T extends string
  ? T
  : T[keyof T] extends spec
  ? { [P in keyof T]: resolve<T[P]> }
  : never;
type resolveOptions<T> = T extends Array<infer T3>
  ? Exclude<resolveOptionsNoArray<T3>, undefined>
  : resolveOptionsNoArray<T>;

export function options<T extends Array<spec>>(
  ...args: T
): parser<resolveOptions<T[number]>> {
  const opts = args.map(
    (opt) =>
      (typeof opt == "string" ? literal(opt) : parser(opt)) as parser<
        resolveOptions<T[number]>
      >
  );
  return (state: state) => {
    const begin = state.position;
    for (const opt of opts) {
      try {
        return opt(state);
      } catch (e) {
        if (e != null) {
          throw e;
        }
      }
      state.position = begin;
    }
    throw null;
  };
}

export function regex(pattern: RegExp): parser<string> {
  if (!pattern.sticky) {
    pattern = RegExp(pattern.source, "y");
  }
  return (state: state) => {
    pattern.lastIndex = state.position;
    const match = pattern.exec(state.text);
    if (match == null) {
      throw null;
    }
    state.position += match[0].length;
    return match[0];
  };
}

export function sequence<TSpec extends spec>(
  list: TSpec[]
): parser<resolve<TSpec>> {
  if (list.length == 0) {
    throw Error("Sequence is empty");
  }
  const cList = list.map(parser);
  return (state: state) => {
    let retval: resolve<TSpec> = null!;
    for (const p of cList) {
      retval = p(state) || retval;
    }
    return retval;
  };
}

export function structure<T>(obj: {
  [key: string]: spec;
}): parser<{ [key: string]: T }> {
  return (state: state) => {
    const retval: { [key: string]: T } = {};
    for (const key in obj) {
      retval[key] = parser(obj[key])(state);
    }
    return retval;
  };
}

export function convert<TSrc extends spec, TDst>(
  inner: TSrc,
  converter: (x: resolve<TSrc>) => TDst
): parser<TDst> {
  const cInner = parser(inner);
  return (state: state) => {
    return converter(cInner(state));
  };
}

export function stringify<TSpec extends spec>(inner: TSpec): parser<string> {
  const cInner = parser(inner);
  return (state: state) => {
    const start = state.position;
    cInner(state);
    const end = state.position;
    return state.text.substring(start, end);
  };
}

export function unary<T = any>(): (arg: state | parser<T>) => T {
  let inner: parser<T> | null = null;
  return (arg: state | parser<T>) => {
    if (typeof arg == "object") {
      if (inner == null) {
        throw Error("Unary not set");
      }
      return inner(arg as state);
    } else if (inner == null && typeof arg == "function") {
      inner = arg;
      return undefined!;
    } else {
      throw Error("Invalid argument");
    }
  };
}

export const integer = convert(/\d+/, Number);
export const float = convert(/[+-]?([0-9]*[.])?[0-9]+/, Number);
