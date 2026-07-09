import {
  getJsonTreeClosingPadding,
  getJsonTreeContainerPadding,
  getJsonTreeLeafPadding,
  JSON_TREE_INDENT_PX,
  JSON_TREE_TOGGLE_GUTTER_PX,
} from "../jsonTreeLayout";

export function runJsonTreeLayoutTests() {
  console.assert(
    getJsonTreeLeafPadding(0) === 0,
    "root scalar should not be indented"
  );
  console.assert(
    getJsonTreeContainerPadding(1) === JSON_TREE_INDENT_PX,
    "container rows should keep the base depth indent"
  );
  console.assert(
    getJsonTreeLeafPadding(1) === JSON_TREE_INDENT_PX + JSON_TREE_TOGGLE_GUTTER_PX,
    "leaf rows inside an expanded container should reserve the chevron gutter"
  );
  console.assert(
    getJsonTreeClosingPadding(1) === JSON_TREE_INDENT_PX + JSON_TREE_TOGGLE_GUTTER_PX,
    "closing braces should align with the opening brace content"
  );
}

runJsonTreeLayoutTests();
