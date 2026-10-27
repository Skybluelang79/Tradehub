import fs from "fs";
let content = fs.readFileSync("src/App.jsx", "utf8");
if(!content.includes("Storefront")) {
  content = content.replace("import { ItemDetail } from './pages';", "import { ItemDetail } from './pages';\nimport Storefront from './pages/Storefront';");
  content = content.replace("import RefundPolicy from './pages/legal/RefundPolicy';", "import RefundPolicy from './pages/legal/RefundPolicy';\nimport TermsOfService from './pages/legal/TermsOfService';\nimport PrivacyPolicy from './pages/legal/PrivacyPolicy';\nimport ProhibitedItems from './pages/legal/ProhibitedItems';\nimport CookiePolicy from './pages/legal/CookiePolicy';");
  content = content.replace("<Route path='/messages/:id' element={<PrivateRoute><Messages /></PrivateRoute>} />", "<Route path='/messages/:id' element={<PrivateRoute><Messages /></PrivateRoute>} />\n        <Route path='/store/:username' element={<Storefront />} />\n        <Route path='/terms' element={<TermsOfService />} />\n        <Route path='/privacy' element={<PrivacyPolicy />} />\n        <Route path='/refund-policy' element={<RefundPolicy />} />\n        <Route path='/prohibited' element={<ProhibitedItems />} />\n        <Route path='/cookies' element={<CookiePolicy />} />");
  fs.writeFileSync("src/App.jsx", content);
  console.log("updated");
} else console.log("exists");
}
