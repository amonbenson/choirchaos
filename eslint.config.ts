import stylistic from "@stylistic/eslint-plugin";
import pluginVitest from "@vitest/eslint-plugin";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import type { Rule } from "eslint";
import { globalIgnores } from "eslint/config";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import pluginVue from "eslint-plugin-vue";

/** The few fields the rule reads, loose enough for TypeScript nodes, which ESLint's own types do not list. */
type Node = { type: string; expression?: Node; body?: Node | Node[]; argument?: Node };

function unwrap(node: Node | undefined): Node | undefined {
  return node?.type === "TSAsExpression" || node?.type === "TSSatisfiesExpression" ? unwrap(node.expression) : node;
}

function isFresh(node: Node | undefined): boolean {
  const type = unwrap(node)?.type;
  return type === "ArrayExpression" || type === "ObjectExpression";
}

function returnsFreshValue(getter: Node): boolean {
  if (getter.type !== "ArrowFunctionExpression" && getter.type !== "FunctionExpression") {
    return false;
  }

  const body = getter.body as Node;
  if (body.type !== "BlockStatement") {
    return isFresh(body);
  }

  return (body.body as Node[]).some(statement => statement.type === "ReturnStatement" && isFresh(statement.argument));
}

// Vue compares a getter's result by identity, so a getter building a new array or object fires the callback on every
// re-run. A callback that writes something the getter reads then triggers itself without end.
const noFreshWatchGetter: Rule.RuleModule = {
  meta: {
    type: "problem",
    messages: { freshGetter: "Pass the watched values as an array of getters, watch([() => a, () => b], ...), not a getter returning a new array or object." },
    schema: [],
  },
  create: context => ({
    CallExpression(node) {
      const [source] = node.arguments;
      if (node.callee.type === "Identifier" && node.callee.name === "watch" && source && returnsFreshValue(source as unknown as Node)) {
        context.report({ node: source, messageId: "freshGetter" });
      }
    },
  }),
};

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
  },
  globalIgnores(["**/dist/**", "**/dist-ssr/**", "**/coverage/**", "**/public/**", "e2e/.cache/**"]),

  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ["src/**/__tests__/*"],
  },

  // disable the legacy core rules to avoid conflicts
  stylistic.configs["disable-legacy"],

  // setup basic stylistic configuration
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: true,
    jsx: false, // Vue project, not JSX
    commaDangle: "always-multiline",
  }),

  {
    name: "app/stylistic-overrides",
    rules: {
      // Enforce 1tbs brace placement. allowSingleLine is false by default,
      // which means { foo(); bar(); } on one line is an error.
      "@stylistic/brace-style": ["error", "1tbs"],

      // Require a blank line after any multiline block (if, for, while, etc.)
      // Only triggers on multiline blocks, not single-line object literals.
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "multiline-block-like", next: "*" },
      ],

      // Ensure no trailing spaces and file ends with a newline
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/eol-last": ["error", "always"],
    },
  },

  {
    name: "app/import-sorting",
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },

  {
    name: "app/tailwind",
    plugins: {
      "better-tailwindcss": betterTailwindcss,
    },
    settings: {
      "better-tailwindcss": {
        // The Tailwind v4 entry file, so the rules know the theme tokens.
        entryPoint: "src/main.css",
      },
    },
    // Errors, not warnings, so CI fails on them. All of them are fixed by lint:fix.
    rules: {
      "better-tailwindcss/enforce-canonical-classes": "error",
      "better-tailwindcss/enforce-consistent-class-order": "error",
      "better-tailwindcss/no-unnecessary-whitespace": "error",
      "better-tailwindcss/no-duplicate-classes": "error",
    },
  },

  {
    name: "app/vue-reactivity",
    plugins: {
      app: { rules: { "no-fresh-watch-getter": noFreshWatchGetter } },
    },
    rules: {
      "app/no-fresh-watch-getter": "error",
    },
  },

  {
    name: "app/overrides",
    rules: {
      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/explicit-function-return-type": ["error", {
        allowExpressions: true, // allow arrow functions like: const fn = () => 42
        allowTypedFunctionExpressions: true, // allow arrow functions like: const fn: MyType = () => 42
      }],

      // Always require curly braces for if/else/for/while/do — no braceless one-liners.
      // This is a logic/correctness rule (not stylistic), so it stays in core ESLint.
      "curly": ["error", "all"],

      // Vue
      "vue/block-order": ["error", { order: ["script", "template", "style"] }],
    },
  },
);
