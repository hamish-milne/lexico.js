export type state = { text: string; position: number; cut?: boolean };

export type parser<T> = (state: state) => T;
export type spec = string | RegExp | parser<unknown> | objSpec | spec[];
type objSpec = { [key: string]: spec };
type punctuationKeys = "_" | "__" | "___" | "____" | "_____";

type resolveObj<T> = T extends RegExp
  ? never
  : T extends parser<unknown>
  ? never
  : T[keyof T] extends spec
  ? { [P in Exclude<keyof T, punctuationKeys>]: resolve<T[P]> }
  : never;
type resolveNoArray<T> =
  | (T extends parser<infer T3> ? T3 : never)
  | (T extends string ? undefined : never)
  | (T extends RegExp ? undefined : never)
  | resolveObj<T>;
type resolve<T> =
  | resolveNoArray<T>
  | (T extends Array<infer T2>
      ? Exclude<resolveNoArray<T2>, undefined>
      : never);

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

export function punctuation<T extends string>(match: T): parser<undefined> {
  return regex(RegExp(rEscape(match), "y"));
}

export function literal<T extends string>(match: T): parser<T> {
  return convert(regex(RegExp(rEscape(match), "y")), () => match);
}

export function char(chars: string): parser<undefined> {
  return regex(RegExp(`[${rEscape(chars)}]`, "y"));
}

export function range(a: string, b: string): parser<undefined> {
  if (a.length != 1 || b.length != 1) {
    throw Error("String length must be 1");
  }
  return regex(RegExp(`^[${rEscape(a)}-${rEscape(b)}]`, "y"));
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

// 'options' resolves parsers slightly differently to other generators
type resolveOptionsNoArray<T> =
  | (T extends Array<infer T2> ? Exclude<resolveNoArray<T2>, undefined> : never)
  | (T extends parser<infer T3> ? T3 : never)
  | (T extends string ? T : never) ///<-- Strings use their literal value
  | (T extends RegExp ? string : never) ///<-- Regex always captures
  | resolveObj<T>;
// T will always be an Array for 'options'
type resolveOptions<T> = T extends Array<infer T2>
  ? Exclude<resolveOptionsNoArray<T2>, undefined>
  : never;

export function options<TSpec extends spec & Array<spec>>(
  ...args: TSpec
): parser<resolveOptions<TSpec>> {
  const opts = args.map((opt) => {
    if (typeof opt == "string") {
      return literal(opt);
    } else if (opt instanceof RegExp) {
      return capture(opt);
    } else {
      return parser(opt);
    }
  }) as parser<resolveOptions<TSpec>>[];
  return (state: state) => {
    const begin = state.position;
    const wasCut = state.cut;
    state.cut = false;
    for (const opt of opts) {
      try {
        const optVal = opt(state);
        state.cut = wasCut;
        return optVal;
      } catch (e) {
        if (e != null) {
          throw e;
        }
      }
      if (state.cut) {
        break;
      }
      state.position = begin;
    }
    state.cut = wasCut;
    throw null;
  };
}

export function cut(state: state): undefined {
  state.cut = true;
  return undefined;
}

export function regex(pattern: RegExp): parser<undefined> {
  if (!pattern.sticky) {
    pattern = RegExp(pattern.source, "y");
  }
  return (state: state) => {
    pattern.lastIndex = state.position;
    if (pattern.test(state.text)) {
      state.position = pattern.lastIndex;
      return undefined;
    } else {
      throw null;
    }
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

export function structure<TSpec extends spec>(obj: {
  [key: string]: TSpec;
}): parser<{ [key: string]: resolve<TSpec> }> {
  return (state: state) => {
    const retval: { [key: string]: resolve<TSpec> } = {};
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

export function capture<TSpec extends spec>(inner: TSpec): parser<string> {
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

export function eof(state: state): undefined {
  if (state.position < state.text.length) {
    throw null;
  }
  return undefined;
}

export function not(inner: spec): parser<undefined> {
  const cInner = parser(inner);
  return (state: state) => {
    const start = state.position;
    try {
      cInner(state);
    } catch {
      state.position = start;
      return undefined;
    }
    throw null;
  };
}

export const integer = convert(capture(/\d+/), Number);
export const float = convert(capture(/[+-]?([0-9]*[.])?[0-9]+/), Number);
