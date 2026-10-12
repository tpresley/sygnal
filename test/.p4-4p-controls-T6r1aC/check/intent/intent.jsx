Search.intent = ({ DOM }) => ({
  QUERY: DOM.input(Query).value(),
  CLEAR: DOM.click(Clear),
  // a control on a page-wide source: clicks on the Close button, wherever it is rendered
  CLOSE: DOM.select('document').select(Close).events('click'),
})
