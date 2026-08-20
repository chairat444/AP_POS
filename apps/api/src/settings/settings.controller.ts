import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { mkdirSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Public } from "../auth/public.decorator";
import {
  CUSTOMER_ADS_IMAGE_MAX_BYTES,
  CUSTOMER_ADS_VIDEO_MAX_BYTES,
  CUSTOMER_DISPLAY_IMAGE_MAX_BYTES,
  type UpdateBrandingDto,
  type UpdateCustomerAdsDto,
  type UpdateDisplayDto,
  type UpdateKeybindingsDto,
  type UpdatePointsDto,
  type UpdatePricingDto,
} from "./settings.types";
import { SettingsService } from "./settings.service";

function customerDisplayUpload() {
  return FileInterceptor("file", {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), "uploads", "customer-display");
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname) || ".png";
        cb(
          null,
          `display-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
        );
      },
    }),
    limits: { fileSize: CUSTOMER_DISPLAY_IMAGE_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype === "image/jpeg" ||
        file.mimetype === "image/png" ||
        file.mimetype === "image/webp" ||
        file.mimetype === "image/gif";
      if (!ok) {
        cb(new Error("รองรับ JPG/PNG/WebP/GIF"), false);
        return;
      }
      cb(null, true);
    },
  });
}

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Get("points")
  points() {
    return this.settings.getPoints();
  }

  @Patch("points")
  updatePoints(@Body() body: UpdatePointsDto) {
    return this.settings.updatePoints(body);
  }

  @Get("display")
  display() {
    return this.settings.getDisplay();
  }

  @Patch("display")
  updateDisplay(@Body() body: UpdateDisplayDto) {
    return this.settings.updateDisplay(body);
  }

  @Post("display/banner")
  @UseInterceptors(customerDisplayUpload())
  uploadBanner(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("ไม่พบไฟล์");
    if (file.size > CUSTOMER_DISPLAY_IMAGE_MAX_BYTES) {
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      throw new BadRequestException("ไฟล์ต้องไม่เกิน 8MB");
    }
    return this.settings.setDisplayMedia("banner", file.filename);
  }

  @Delete("display/banner")
  clearBanner() {
    return this.settings.clearDisplayMedia("banner");
  }

  @Post("display/mid-banner")
  @UseInterceptors(customerDisplayUpload())
  uploadMidBanner(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("ไม่พบไฟล์");
    if (file.size > CUSTOMER_DISPLAY_IMAGE_MAX_BYTES) {
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      throw new BadRequestException("ไฟล์ต้องไม่เกิน 8MB");
    }
    return this.settings.setDisplayMedia("midBanner", file.filename);
  }

  @Delete("display/mid-banner")
  clearMidBanner() {
    return this.settings.clearDisplayMedia("midBanner");
  }

  @Post("display/panel")
  @UseInterceptors(customerDisplayUpload())
  uploadPanel(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("ไม่พบไฟล์");
    if (file.size > CUSTOMER_DISPLAY_IMAGE_MAX_BYTES) {
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      throw new BadRequestException("ไฟล์ต้องไม่เกิน 8MB");
    }
    return this.settings.setDisplayMedia("panel", file.filename);
  }

  @Delete("display/panel")
  clearPanel() {
    return this.settings.clearDisplayMedia("panel");
  }

  @Get("pricing")
  pricing() {
    return this.settings.getPricing();
  }

  @Patch("pricing")
  updatePricing(@Body() body: UpdatePricingDto) {
    return this.settings.updatePricing(body);
  }

  /** โลโก้/ชื่อร้าน — เปิด public เพื่อหน้า login */
  @Public()
  @Get("branding")
  branding() {
    return this.settings.getBranding();
  }

  @Patch("branding")
  updateBranding(@Body() body: UpdateBrandingDto) {
    return this.settings.updateBranding(body);
  }

  @Post("logo")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "branding");
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safe = `upload-${Date.now()}${extname(file.originalname) || ".png"}`;
          cb(null, safe);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
          cb(new Error("รองรับเฉพาะไฟล์รูป"), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return this.settings.get();
    }
    return this.settings.setLogo(file.filename);
  }

  @Delete("logo")
  clearLogo() {
    return this.settings.clearLogo();
  }

  @Get("customer-ads")
  customerAds() {
    return this.settings.getCustomerAds();
  }

  @Patch("customer-ads")
  updateCustomerAds(@Body() body: UpdateCustomerAdsDto) {
    return this.settings.updateCustomerAds(body);
  }

  @Get("keybindings")
  keybindings() {
    return this.settings.getKeybindings();
  }

  @Patch("keybindings")
  updateKeybindings(@Body() body: UpdateKeybindingsDto) {
    return this.settings.updateKeybindings(body);
  }

  @Delete("keybindings")
  resetKeybindings() {
    return this.settings.resetKeybindings();
  }

  @Post("customer-ads")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "customer-ads");
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const ext =
            extname(file.originalname) ||
            (file.mimetype.startsWith("video/") ? ".mp4" : ".jpg");
          cb(null, `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
        },
      }),
      limits: { fileSize: CUSTOMER_ADS_VIDEO_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        const isImage = file.mimetype.startsWith("image/");
        const isVideo = file.mimetype.startsWith("video/");
        if (!isImage && !isVideo) {
          cb(new Error("รองรับเฉพาะรูปหรือวิดีโอ"), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadCustomerAd(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("ไม่พบไฟล์");
    }
    const isImage = file.mimetype.startsWith("image/");
    const tooBig =
      (isImage && file.size > CUSTOMER_ADS_IMAGE_MAX_BYTES) ||
      (!isImage && file.size > CUSTOMER_ADS_VIDEO_MAX_BYTES);
    if (tooBig) {
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      throw new BadRequestException(
        isImage ? "รูปต้องไม่เกิน 5MB" : "วิดีโอต้องไม่เกิน 40MB",
      );
    }
    return this.settings.addCustomerAd(file);
  }

  @Patch("customer-ads/:id")
  patchCustomerAd(
    @Param("id") id: string,
    @Body()
    body: Partial<{
      active: boolean;
      durationSec: number;
      name: string;
      sort: number;
    }>,
  ) {
    return this.settings.patchCustomerAd(id, body);
  }

  @Delete("customer-ads/:id")
  removeCustomerAd(@Param("id") id: string) {
    return this.settings.removeCustomerAd(id);
  }
}
