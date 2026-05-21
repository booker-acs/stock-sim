export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ticker, date } = req.body && Object.keys(req.body).length
      ? req.body
      : await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => { data += chunk; });
          req.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
          req.on('error', reject);
        });

    if (!ticker) return res.status(400).json({ error: 'ticker required' });

    // Historical: fetch a date range around the requested date
    // Current: fetch last 5 days to get current + previous close
    const isHistorical = date && date < new Date().toISOString().slice(0, 10);

    let url;
    if (isHistorical) {
      // Get a 7-day window around the date to handle weekends/holidays
      const target = new Date(date + 'T12:00:00Z');
      const from = new Date(target); from.setDate(from.getDate() - 5);
      const to = new Date(target); to.setDate(to.getDate() + 1);
      const period1 = Math.floor(from.getTime() / 1000);
      const period2 = Math.floor(to.getTime() / 1000);
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${period1}&period2=${period2}`;
    } else {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo returned ${response.status}` });
    }

    const data = await response.json();
    const chart = data?.chart?.result?.[0];

    if (!chart) return res.status(404).json({ error: 'No data found for ticker' });

    const closes = chart.indicators?.quote?.[0]?.close || [];
    const timestamps = chart.timestamp || [];
    const meta = chart.meta || {};
    const companyName = meta.longName || meta.shortName || ticker;

    // Filter out null closes
    const validPoints = timestamps
      .map((ts, i) => ({ ts, close: closes[i] }))
      .filter(p => p.close != null);

    if (!validPoints.length) return res.status(404).json({ error: 'No valid price data' });

    if (isHistorical) {
      // Find the closest trading day on or before the requested date
      const targetTs = new Date(date + 'T23:59:59Z').getTime() / 1000;
      const best = validPoints.filter(p => p.ts <= targetTs).pop();
      if (!best) return res.status(404).json({ error: 'No trading data for that date' });
      const actualDate = new Date(best.ts * 1000).toISOString().slice(0, 10);
      return res.status(200).json({ ticker, closePrice: best.close, actualDate, companyName });
    } else {
      const current = validPoints[validPoints.length - 1].close;
      const previous = validPoints.length > 1
        ? validPoints[validPoints.length - 2].close
        : current;
      return res.status(200).json({ ticker, currentPrice: current, previousClose: previous, companyName });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
