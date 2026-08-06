// @ts-check
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const STABLE_ID_PREFIX = /^\[[EW]:[A-Z0-9_]+:[A-Z0-9_]+\]/;

function getStaticStringStart(node) {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.quasis.length > 0) {
    return node.quasis[0].value.raw;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = getStaticStringStart(node.left);
    if (left === null) return null;
    if (left.length > 0) return left;
    return getStaticStringStart(node.right);
  }
  return null;
}

const consoleStableIdRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce stable ID prefixes in console.error and console.warn",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "console" ||
          callee.property.type !== "Identifier" ||
          (callee.property.name !== "error" && callee.property.name !== "warn")
        ) {
          return;
        }

        const firstArg = node.arguments[0];
        if (!firstArg) {
          context.report({
            node,
            message:
              "console.error and console.warn must start with a stable ID prefix: [E:MODULE:CODE] or [W:MODULE:CODE]",
          });
          return;
        }

        const value = getStaticStringStart(firstArg);
        if (value === null) {
          context.report({
            node: firstArg,
            message:
              "console.error and console.warn must use a static first argument with a stable ID prefix",
          });
          return;
        }

        if (!STABLE_ID_PREFIX.test(value)) {
          context.report({
            node: firstArg,
            message:
              "console.error and console.warn must start with a stable ID prefix: [E:MODULE:CODE] or [W:MODULE:CODE]",
          });
        }
      },
    };
  },
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/release/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "apps/desktop/src/main/**",
    ],
  },
  {
    files: [
      "apps/desktop/src/renderer/**/*.{ts,tsx,js,jsx}",
      "plugins/*/src/**/*.{ts,tsx,js,jsx}",
      "plugins/*/ui/**/*.{ts,tsx,js,jsx}",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      quantnexus: {
        rules: {
          "console-stable-id": consoleStableIdRule,
        },
      },
    },
    rules: {
      "quantnexus/console-stable-id": "error",
    },
  },
];
