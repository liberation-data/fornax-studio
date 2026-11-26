// Draws the Inspect window's synthetic sample images into public/samples/: an invoice (a made-up supplier, customer
// and items) and a tray of machined parts with one dented. Nothing in them is real.
//
//   java scripts/DrawSamples.java           (JDK 22 or later runs a single source file as it is)
//
// The chest X-ray beside them is not drawn: it is a CC0 image from Wikimedia Commons (public/samples/NOTICE.md).

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.Area;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;

void main() throws Exception {
    Path out = Path.of(System.getProperty("out", "public/samples"));
    Files.createDirectories(out);
    ImageIO.write(invoice(), "png", out.resolve("invoice.png").toFile());
    ImageIO.write(tray(), "png", out.resolve("tray.png").toFile());
    System.out.println("Drew invoice.png and tray.png in " + out);
}

Graphics2D smooth(BufferedImage img) {
    Graphics2D g = img.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    return g;
}

/** A supplier's invoice: fictional names, a reserved 555 phone number, an example.com address. */
BufferedImage invoice() {
    int w = 1000, h = 1300;
    var img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
    Graphics2D g = smooth(img);
    g.setColor(Color.WHITE);
    g.fillRect(0, 0, w, h);
    Color ink = new Color(0x22262B), brand = new Color(0x9A3412);
    g.setColor(brand);
    g.fillRect(0, 0, w, 12);
    g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 40));
    g.drawString("Ember & Ash Ceramics", 60, 100);
    g.setColor(ink);
    g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 19));
    g.drawString("Unit 4, 210 Foundry Road, Millbrook 3999", 60, 136);
    g.drawString("accounts@example.com  ·  (555) 014-2290", 60, 162);

    g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 34));
    g.drawString("TAX INVOICE", 620, 100);
    g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 20));
    String[][] meta = {{"Invoice no.", "EA-3318"}, {"Date", "9 October 2026"}, {"Due", "8 November 2026"}};
    int y = 140;
    for (String[] m : meta) {
        g.drawString(m[0], 620, y);
        g.drawString(m[1], 760, y);
        y += 28;
    }

    g.setColor(new Color(0xF4EEE9));
    g.fillRoundRect(60, 240, 880, 110, 14, 14);
    g.setColor(ink);
    g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 18));
    g.drawString("BILL TO", 84, 274);
    g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 20));
    g.drawString("Northgate Café Group (fictional)", 84, 304);
    g.drawString("17 Harbour Street, Seaton 3998", 84, 332);

    y = 420;
    g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 19));
    g.drawString("Description", 60, y);
    g.drawString("Qty", 590, y);
    g.drawString("Unit price", 680, y);
    g.drawString("Amount", 830, y);
    g.setStroke(new BasicStroke(2));
    g.drawLine(60, y + 14, 940, y + 14);
    g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 20));
    String[][] items = {
            {"Stoneware dinner plate, 27 cm, speckled", "48", "14.50", "696.00"},
            {"Espresso cup and saucer, matte white", "60", "9.80", "588.00"},
            {"Serving bowl, 30 cm, ash glaze", "12", "38.00", "456.00"},
            {"Custom logo stamp (one-off setup)", "1", "120.00", "120.00"},
            {"Freight, palletised", "1", "85.00", "85.00"},
    };
    g.setStroke(new BasicStroke(1));
    for (String[] it : items) {
        y += 52;
        g.drawString(it[0], 60, y);
        g.drawString(it[1], 596, y);
        g.drawString("$" + it[2], 680, y);
        g.drawString("$" + it[3], 830, y);
        g.setColor(new Color(0xE6E1DC));
        g.drawLine(60, y + 18, 940, y + 18);
        g.setColor(ink);
    }
    y += 70;
    g.drawString("Subtotal", 680, y);
    g.drawString("$1,945.00", 830, y);
    y += 36;
    g.drawString("GST (10%)", 680, y);
    g.drawString("$194.50", 830, y);
    y += 20;
    g.setStroke(new BasicStroke(2));
    g.drawLine(660, y, 940, y);
    y += 40;
    g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 24));
    g.drawString("Total", 680, y);
    g.drawString("$2,139.50", 830, y);

    g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 17));
    g.setColor(new Color(0x5B6168));
    g.drawString("Payment by bank transfer within 30 days, quoting the invoice number.", 60, h - 110);
    g.setFont(new Font(Font.SANS_SERIF, Font.ITALIC, 16));
    g.drawString("Sample invoice for Fornax Studio: every name, address and figure on it is made up.", 60, h - 70);
    g.dispose();
    return img;
}

/** A tray of identical machined discs, top-down under soft light; one, row 2 column 4, has a dent in its rim. */
BufferedImage tray() {
    int cols = 6, rows = 4, cell = 150, margin = 50, w = cols * cell + 2 * margin, h = rows * cell + 2 * margin, r = 54;
    int dentCol = 3, dentRow = 1;
    var img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
    Graphics2D g = smooth(img);
    g.setPaint(new GradientPaint(0, 0, new Color(0x3A4048), w, h, new Color(0x23272D)));
    g.fillRect(0, 0, w, h);
    // The tray's lip, and a pocket under each part.
    g.setColor(new Color(0x4B525B));
    g.setStroke(new BasicStroke(6));
    g.draw(new RoundRectangle2D.Double(16, 16, w - 32, h - 32, 28, 28));
    var noise = new Random(7);
    for (int row = 0; row < rows; row++) {
        for (int col = 0; col < cols; col++) {
            int cx = margin + col * cell + cell / 2, cy = margin + row * cell + cell / 2;
            g.setColor(new Color(0x1B1E22));
            g.fill(new Ellipse2D.Double(cx - r - 8, cy - r - 8, 2 * (r + 8), 2 * (r + 8)));
            // A soft shadow down and to the right.
            g.setColor(new Color(0, 0, 0, 90));
            g.fill(new Ellipse2D.Double(cx - r + 5, cy - r + 7, 2 * r, 2 * r));
            Area part = new Area(new Ellipse2D.Double(cx - r, cy - r, 2 * r, 2 * r));
            boolean dented = col == dentCol && row == dentRow;
            if (dented) part.subtract(new Area(new Ellipse2D.Double(cx + r * 0.3, cy - r * 1.2, r * 1.05, r * 1.05)));
            float jitter = noise.nextFloat() * 0.04f;
            g.setPaint(new RadialGradientPaint(cx - r / 3f, cy - r / 3f, r * 1.6f, new float[] {0f, 0.6f, 1f},
                    new Color[] {new Color(0.86f - jitter, 0.88f - jitter, 0.9f - jitter), new Color(0xA9AFB7), new Color(0x7D838B)}));
            g.fill(part);
            g.setColor(new Color(0x6C7279));
            g.setStroke(new BasicStroke(2));
            g.draw(part);
            // A turned ring and a bore.
            g.setColor(new Color(255, 255, 255, 60));
            g.draw(new Ellipse2D.Double(cx - r * 0.62, cy - r * 0.62, r * 1.24, r * 1.24));
            g.setPaint(new RadialGradientPaint(cx, cy, 16, new float[] {0f, 1f}, new Color[] {new Color(0x2A2E33), new Color(0x575D64)}));
            g.fill(new Ellipse2D.Double(cx - 16, cy - 16, 32, 32));
        }
    }
    g.dispose();
    return img;
}
