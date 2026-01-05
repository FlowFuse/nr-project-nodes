import globals from "globals"
import html from "eslint-plugin-html"
import js from "@eslint/js"
import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import stylistic from '@stylistic/eslint-plugin'
import noOnlyTests from 'eslint-plugin-no-only-tests'

export default [
    {
        files: ["**/*.js"],
        languageOptions: {
            globals: {
                ...globals.browser
            },
            sourceType: "script"
        }
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.mocha
            },
            sourceType: 'script'
        }
    },
    {
        files: ["**/*.html"],
        plugins: { html },
        settings: {
            "html/indent": "space",
            "html/report-bad-indent": "error"
        },
        languageOptions: {
            globals: {
                ...globals.browser
            }
        },
        rules: {
            // the html plugin does not know about the @stylistic quotes rule, so we have to include this here.
            'quotes': ['error', 'single', { 'allowTemplateLiterals': true, 'avoidEscape': true }]
        }
    },
    {
        ignores: [
            ...resolveIgnoresFromGitignore()
        ]
    },
    js.configs.recommended,
    // stylistic.configs['recommended-flat'],
    ...neostandard(),
    {
        plugins: {
            "@stylistic": stylistic,
            'no-only-tests': noOnlyTests
        },
        rules: {
            'object-shorthand': ['error'],
            'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }],

            "camelcase": "off",
            'eqeqeq': 'error',
            "no-empty": ["error", { "allowEmptyCatch": true }],
            "no-unused-vars": ["error", {
                "args": "none",
                "caughtErrors": "none"
            }],
            "yoda": "off",
            '@stylistic/indent': ['warn', 4], // https://eslint.style/rules/indent#options
            "@stylistic/linebreak-style": ["error", "unix"],
            "@stylistic/quotes": ["off", "single", { "avoidEscape": true }],
            "@stylistic/quote-props": ["warn", "consistent"],
            '@stylistic/no-multi-spaces': 'error', // https://eslint.style/rules/no-multi-spaces#no-multi-spaces
            '@stylistic/comma-dangle': ['error', 'never'] // https://eslint.style/rules/comma-dangle#comma-dangle
        }
    }
]
