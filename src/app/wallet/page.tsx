"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Navbar from "@/components/Navbar";
import { showToast } from "@/components/Toast";
import { formatCoins } from "@/lib/format";

const PACKAGES = [
  { coins: 100, price: 1.0, label: "Starter", bonus: "" },
  { coins: 500, price: 5.0, label: "Popular", bonus: "+0c bonus" },
  { coins: 1000, price: 10.0, label: "Best Value", bonus: "+0c bonus" },
  { coins: 5000, price: 50.0, label: "Whale", bonus: "+0c bonus" },
];

export default function WalletPage() {
  const { data: session, update } = useSession();
  const [selectedPkg, setSelectedPkg] = useState<typeof PACKAGES[0] | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  const balance = (session?.user as any)?.balance || 0;
  const isAdmin = (session?.user as any)?.isAdmin;

  function formatCardNumber(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  }

  function formatExpiry(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) {
      return digits.slice(0, 2) + " / " + digits.slice(2);
    }
    return digits;
  }

  async function handlePurchase() {
    if (!selectedPkg) return;
    setProcessing(true);

    await new Promise((r) => setTimeout(r, 2000));

    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paypalOrderId: `card_${Date.now()}_${selectedPkg.coins}` }),
      });
      const data = await res.json();
      if (res.ok) {
        await update();
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          setSelectedPkg(null);
          setCardNumber("");
          setCardExpiry("");
          setCardCvc("");
          setCardName("");
        }, 3000);
      } else {
        showToast(data.error || "Payment failed", "error");
      }
    } catch {
      showToast("Error processing payment", "error");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-2">Purchase Coins</h1>
        <p className="text-gray-400 mb-8">Buy coins to trade on the stock market</p>

        <div className="glass-card mb-8">
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Your Balance</div>
            {isAdmin ? (
              <>
                <div className="text-5xl font-bold gradient-text">Unlimited</div>
                <div className="text-sm text-yellow-400 mt-1">Admin: free trades, no purchase needed</div>
              </>
            ) : (
              <>
                <div className="text-5xl font-bold gradient-text">{formatCoins(balance)}</div>
                <div className="text-sm text-gray-500 mt-1">~ ${(balance / 10000).toFixed(2)} USD value</div>
              </>
            )}
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white mb-4">Select a Package</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {PACKAGES.map((pkg) => (
            <button
              key={pkg.coins}
              onClick={() => !isAdmin && setSelectedPkg(pkg)}
              disabled={isAdmin}
              className={`glass-card text-center transition-all ${
                isAdmin
                  ? "opacity-50 cursor-not-allowed"
                  : selectedPkg?.coins === pkg.coins
                  ? "border-blue-500 ring-2 ring-blue-500/30"
                  : "hover:border-gray-600"
              }`}
            >
              <div className="text-xs text-blue-400 font-medium mb-1">{pkg.label}</div>
              <div className="text-2xl font-bold text-white">{pkg.coins.toLocaleString()}c</div>
              <div className="text-lg text-gray-300 font-semibold">${pkg.price.toFixed(2)}</div>
              <div className="text-xs text-gray-500 mt-1">{pkg.bonus || "Standard"}</div>
            </button>
          ))}
        </div>

        {isAdmin && (
          <div className="glass-card text-center mb-8 border-yellow-500/30">
            <p className="text-yellow-400 font-semibold">Admin accounts have unlimited coins. No purchase needed.</p>
          </div>
        )}

        {selectedPkg && !isAdmin && (
          <div className="glass-card mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">
              Pay ${selectedPkg.price.toFixed(2)} for {selectedPkg.coins.toLocaleString()}c
            </h3>

            {success ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">&#10003;</div>
                <div className="text-xl font-bold text-green-400">Payment Successful!</div>
                <div className="text-gray-400 mt-2">{selectedPkg.coins.toLocaleString()}c added to your balance</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Cardholder Name</label>
                  <input
                    type="text"
                    placeholder="John Smith"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Card Number</label>
                  <input
                    type="text"
                    placeholder="4242 4242 4242 4242"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    className="input-field"
                    maxLength={19}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Expiry</label>
                    <input
                      type="text"
                      placeholder="MM / YY"
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                      className="input-field"
                      maxLength={7}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">CVC</label>
                    <input
                      type="text"
                      placeholder="123"
                      value={cardCvc}
                      onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      className="input-field"
                      maxLength={4}
                    />
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-400">
                  <strong className="text-yellow-400">Demo Mode:</strong> This is a simulated payment. No real charges will be made.
                  To accept real card payments, integrate Stripe or PayPal Cards API.
                </div>

                <button
                  onClick={handlePurchase}
                  disabled={processing || !cardName || cardNumber.replace(/\s/g, "").length < 16 || cardExpiry.replace(/\D/g, "").length < 4 || cardCvc.length < 3}
                  className="btn-success w-full py-3 text-lg"
                >
                  {processing ? "Processing..." : `Pay $${selectedPkg.price.toFixed(2)}`}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="glass-card">
          <h3 className="text-lg font-semibold text-white mb-4">How Purchases Work</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-400">
            <div>
              <div className="text-blue-400 font-semibold mb-1">1. Select Package</div>
              <p>Choose how many coins you want to purchase</p>
            </div>
            <div>
              <div className="text-green-400 font-semibold mb-1">2. Enter Payment</div>
              <p>Use a debit or credit card to pay securely</p>
            </div>
            <div>
              <div className="text-purple-400 font-semibold mb-1">3. Start Trading</div>
              <p>Coins are added instantly to your wallet</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
