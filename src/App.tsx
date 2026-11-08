import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { CartProvider } from "./context/CartContext";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import CartDrawer from "./components/CartDrawer";
import { WATCHES, CATALOG_BRANDS } from "./data/watches";
import Home from "./pages/Home";
import About from "./pages/About";
import Collection from "./pages/Collection";
import Contact from "./pages/Contact";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route
              path="/collection"
              element={
                <Collection
                  heading="The Collection"
                  sub={`Our live in-store stock — ${WATCHES.length} watches across ${CATALOG_BRANDS.join(", ")}. Filter by brand or price, click a watch for details, and add your favourites to the cart.`}
                />
              }
            />
            <Route
              path="/mens"
              element={
                <Collection
                  heading="Men's Collection"
                  sub={`${WATCHES.filter((w) => w.gender === "men").length} men's watches in stock — from field-proof G-Shocks and Eco-Drive Citizens to everyday Titans and Fastracks.`}
                  gender="men"
                />
              }
            />
            <Route
              path="/womens"
              element={
                <Collection
                  heading="Women's Collection"
                  sub={`${WATCHES.filter((w) => w.gender === "women").length} women's watches in stock — Ragas, Baby-Gs and everyday classics, genuine and warranty-backed.`}
                  gender="women"
                />
              }
            />
            <Route path="/contact" element={<Contact />} />
            <Route
              path="*"
              element={
                <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
                  <p className="font-display text-6xl text-gold">404</p>
                  <p className="text-muted">
                    That page took a day off. The watches didn't.
                  </p>
                </div>
              }
            />
          </Routes>
        </main>
        <Footer />
        <CartDrawer />
      </BrowserRouter>
    </CartProvider>
  );
}
