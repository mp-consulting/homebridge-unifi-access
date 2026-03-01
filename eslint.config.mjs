/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * eslint.config.mjs: Linting defaults for Homebridge plugins.
 */
import eslintJs from "@eslint/js";
import hbPluginUtils from "homebridge-plugin-utils/build/eslint-rules.mjs";
import ts from "typescript-eslint";
import tsParser from "@typescript-eslint/parser";

export default ts.config(

  { ignores: ["dist"] },

  eslintJs.configs.recommended,

  {

    files: ["src/**.ts"],
    rules: {

      ...hbPluginUtils.rules.ts
    }
  },

  {

    files: [ "homebridge-ui/public/**/*.js", "homebridge-ui/public/modules/**/*.js", "homebridge-ui/server.js", "eslint.config.mjs" ],
    rules: {

      ...hbPluginUtils.rules.js
    }
  },

  {

    files: [ "src/**.ts", "homebridge-ui/*.js", "homebridge-ui/public/**/*.js", "homebridge-ui/public/modules/**/*.js", "eslint.config.mjs" ],

    languageOptions: {

      ecmaVersion: "latest",
      parser: tsParser,
      parserOptions: {

        ecmaVersion: "latest",

        projectService: {

          allowDefaultProject: [
            "eslint.config.mjs", "homebridge-ui/*.js", "homebridge-ui/public/*.js",
            "homebridge-ui/public/modules/*.js", "homebridge-ui/public/modules/feature-options/*.js"
          ],
          defaultProject: "./tsconfig.json",
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20 // eslint-disable-line camelcase
        }
      },

      sourceType: "module"
    },

    linterOptions: {

      reportUnusedDisableDirectives: "error"
    },

    plugins: {

      ...hbPluginUtils.plugins
    },

    rules: {

      ...hbPluginUtils.rules.common
    }
  },

  {

    files: [ "homebridge-ui/public/*.js", "homebridge-ui/public/modules/*.js", "homebridge-ui/public/modules/**/*.js" ],

    languageOptions: {

      globals: {

        ...hbPluginUtils.globals.ui
      }
    }
  },

  {

    files: ["homebridge-ui/server.js"],

    languageOptions: {

      globals: {

        console: "readonly",
        fetch: "readonly"
      }
    }
  }
);
