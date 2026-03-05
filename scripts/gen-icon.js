const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const ICON_SIZES = [16, 32, 48, 64, 128, 256];

async function generateIcon() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const iconPngPath = path.join(assetsDir, 'icon.png');
  const iconIcoPath = path.join(assetsDir, 'icon.ico');

  let sourceImagePath = null;
  let sourceIsPng = false;

  if (fs.existsSync(iconPngPath)) {
    sourceImagePath = iconPngPath;
    sourceIsPng = true;
  } else if (fs.existsSync(iconIcoPath)) {
    console.error('错误: 请使用 PNG 格式的源图标文件（assets/icon.png）');
    process.exit(1);
  } else {
    console.error('错误: 未找到源图标文件 assets/icon.png');
    process.exit(1);
  }

  try {
    const imageBuffer = await sharp(sourceImagePath).toBuffer();
    const pngBuffers = await Promise.all(
      ICON_SIZES.map(async (size) => {
        return await sharp(imageBuffer)
          .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer();
      })
    );

    const icoBuffer = await pngToIco(pngBuffers);

    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    fs.writeFileSync(iconIcoPath, icoBuffer);
    console.log(`✓ 已生成 ICO 文件: ${iconIcoPath}`);
  } catch (error) {
    console.error('生成图标时出错:', error);
    process.exit(1);
  }
}

generateIcon();
