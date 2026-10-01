`src/Checkout.jsx` has grown too big. Split it into three components, each in its own file with a default export:

- `src/CartTable.jsx`: the cart table (`table.cart`), with the quantity and "Remove" buttons.
- `src/ShippingForm.jsx`: the shipping fieldset (`fieldset.shipping`): the address fields, the shipping method, gift wrap, and the address error messages.
- `src/OrderSummary.jsx`: the order summary (`section.summary`): the amounts, the discount code and the "Place order" button.

`Checkout.jsx` keeps the page layout and the order confirmation, and renders the three parts; it no longer renders any of their markup itself. Each part handles its own buttons and fields. The parts don't import or reach into each other: whatever one part needs from another (the summary needs the cart and the shipping choices; "Place order" has to make the shipping form show its error messages) goes through `Checkout`.

This is a pure refactor. The rendered HTML must stay exactly the same at every step (the same elements, classes, attributes and text, in the same order), and everything must behave exactly as it does now.
