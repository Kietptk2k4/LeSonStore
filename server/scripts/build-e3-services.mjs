import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "controllers/productController.js"), "utf8");

const throwHttp = `function throwHttp(status, message, payload) {
  const err = new Error(message);
  err.status = status;
  if (payload) err.payload = payload;
  throw err;
}
`;

const catalogImports = `const {
  sequelize,
  Product,
  ProductVariation,
  ProductImage,
  Category,
  Brand,
  Tag,
  Question,
  Answer,
  User,
} = require("../../models");
const { Op, Sequelize } = require("sequelize");
const recommendationProxy = require("../recommendationProxy");
const {
  RecommendationUpstreamError,
  RecommendationAdapterError,
  BASE,
} = recommendationProxy;

${throwHttp}
`;

const qaImports = `const notificationService = require("../notificationService");
const {
  Product,
  Question,
  Answer,
  User,
  Role,
} = require("../../models");

${throwHttp}

function getRoleNames(roles) {
  return (roles || []).map((r) => r.role_name);
}

function isStaff(roles) {
  const names = getRoleNames(roles);
  return names.includes("admin") || names.includes("staff");
}

`;

function extractFunction(name, nextExport) {
  const start = src.indexOf(`exports.${name} = async`);
  if (start < 0) throw new Error(`Missing export ${name}`);
  const end =
    nextExport != null
      ? src.indexOf(`exports.${nextExport} = async`, start + 1)
      : src.indexOf("\n};", start) + 3;
  const chunk = src.slice(start, end > start ? end : undefined);
  return chunk.replace(/^exports\.\w+ = async \([^)]*\) => \{/, "").replace(/\n\};?\s*$/, "");
}

// Build catalog pieces manually from known exports
const helpers = src.slice(
  src.indexOf("const parseIdList"),
  src.indexOf("exports.getProductFacets")
);

let getFacets = extractFunction("getProductFacets", "getProductsV2")
  .replace(/res\.json\(/g, "return ")
  .replace(/next\(error\)/g, "throw error");

let listV2 = extractFunction("getProductsV2", "getProducts");
listV2 = listV2
  .replace(/req\.query/g, "query")
  .replace(/res\.json\(/g, "return ");

let listLegacy = extractFunction("getProducts", "getProductDetail");
listLegacy = listLegacy
  .replace(/req\.query/g, "query")
  .replace(/res\.json\(/g, "return ");

let detail = extractFunction("getProductDetail", "getSearchSuggestions");
detail = detail
  .replace(/const \{ id \} = req\.params;/, "const id = idOrSlug;")
  .replace(
    /if \(!product\) return res\.status\(404\)\.json\(\{ message: "Product not found" \}\);/,
    'if (!product) throwHttp(404, "Product not found");'
  )
  .replace(/return res\.json\(\{ product: json \}\);/, "return { body: { product: json } };");

let suggestions = extractFunction("getSearchSuggestions", null);
// getSearchSuggestions next is commented block - find getRecommendedByVariation
const suggEnd = src.indexOf("exports.getRecommendedByVariation");
suggestions = src
  .slice(src.indexOf("exports.getSearchSuggestions"), suggEnd)
  .replace(/exports\.getSearchSuggestions = async \(req, res, next\) => \{/, "")
  .replace(/const search = \(req\.query\.q \|\| ""\)\.trim\(\);/, 'const search = (q || "").trim();')
  .replace(/return res\.json\(/g, "return ")
  .replace(/res\.json\(/g, "return ");

const fetchMetaStart = src.indexOf("async function fetchProductMeta");
const fetchMetaEnd = src.indexOf("exports.getRecommendedByVariation");
const fetchMeta = src.slice(fetchMetaStart, fetchMetaEnd);

let knn = src.slice(
  src.indexOf("exports.getRecommendedByVariation"),
  src.indexOf("exports.getCategories")
);
knn = knn
  .replace(/exports\.getRecommendedByVariation = async \(req, res\) => \{/, "")
  .replace(
    /const variationId = Number\(req\.params\.variation_id\);\n  if \(!variationId\) return res\.status\(400\)\.json\(\{ products: \[\], error: "invalid variation_id" \}\);/,
    `if (!variationId) {
    return { statusCode: 400, body: { products: [], error: "invalid variation_id" } };
  }`
  )
  .replace(/return res\.json\(/g, "return { statusCode: 200, body: ")
  .replace(/return res\.status\(502\)\.json\(/g, "return { statusCode: 502, body: ")
  .replace(/\}\);\s*$/gm, (m, offset, str) => {
    // only fix return lines - fragile
    return m;
  });

// Fix KNN returns - manual post-process
knn = knn.replace(
  /return \{ statusCode: 200, body: \{\s*products,/,
  "return { statusCode: 200, body: { products,"
);
// Actually the replace broke JSON - let me do knn manually in the write file

let categories = extractFunction("getCategories", "getBrands").replace(/res\.json\(/g, "return ");
let brands = extractFunction("getBrands", "createQuestion").replace(/res\.json\(/g, "return ");

let compare = src.slice(src.indexOf("exports.compareProducts"));
compare = compare
  .replace(/exports\.compareProducts = async \(req, res, next\) => \{[\s\S]*?try \{/, "")
  .replace(
    /const ids = Array\.isArray\(req\.body\.ids\)[\s\S]*?if \(!ids\.length\) \{[\s\S]*?\}/,
    `if (!ids || !ids.length) {
      throwHttp(400, "ids is required (array or comma-separated)");
    }`
  )
  .replace(/res\.json\(/g, "return ")
  .replace(/next\(err\)/g, "throw err");

const catalogService = `${catalogImports}
${helpers}
async function getFacets() {
  try {
${getFacets}
  } catch (error) {
    throw error;
  }
}

async function listProductsV2(query) {
  try {
${listV2}
  } catch (error) {
    throw error;
  }
}

async function listProductsLegacy(query) {
  try {
${listLegacy}
  } catch (error) {
    throw error;
  }
}

async function getProductDetail(idOrSlug) {
  try {
${detail}
  } catch (error) {
    throw error;
  }
}

async function getSearchSuggestions(q) {
  try {
${suggestions}
  } catch (error) {
    throw error;
  }
}

${fetchMeta}

async function getRecommendationsByVariation(variationId) {
PLACEHOLDER_KNN
}

async function listCategories() {
  try {
${categories}
  } catch (error) {
    throw error;
  }
}

async function listBrands() {
  try {
${brands}
  } catch (error) {
    throw error;
  }
}

async function compareProducts(ids) {
  try {
${compare}
  } catch (err) {
    throw err;
  }
}

module.exports = {
  getFacets,
  listProductsLegacy,
  listProductsV2,
  getProductDetail,
  getSearchSuggestions,
  getRecommendationsByVariation,
  listCategories,
  listBrands,
  compareProducts,
  parseIdList,
  parseStringList,
};
`;

fs.writeFileSync(path.join(root, "services/product/catalogService.js"), catalogService);
console.log("Wrote catalogService.js (partial - KNN placeholder)");
