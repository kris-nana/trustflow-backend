import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DeliverableService } from './deliverable.service';
import { IpfsPinningService } from '../ipfs-pinning/ipfs-pinning.service';
import { GigService } from '../gig/gig.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { GigStatus } from '../gig/gig.entity';

describe('DeliverableService - File Magic Bytes Validation', () => {
  let service: DeliverableService;
  const FREELANCER = 'G' + 'A'.repeat(55);

  const mockIpfsPinningService = {
    pinContent: jest.fn().mockResolvedValue({ cid: 'QmTest123', size: 1024 }),
  };

  const mockGigService = {
    findById: jest.fn().mockResolvedValue({
      id: 'gig-1',
      status: GigStatus.ACCEPTED,
      acceptedBy: FREELANCER,
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliverableService,
        { provide: IpfsPinningService, useValue: mockIpfsPinningService },
        { provide: GigService, useValue: mockGigService },
        { provide: REDIS_CLIENT, useValue: null },
      ],
    }).compile();

    service = module.get<DeliverableService>(DeliverableService);
  });

  describe('File type validation', () => {
    it('should accept valid PDF file based on magic bytes', async () => {
      // PDF magic bytes: %PDF-
      const pdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n');
      const base64Content = pdfBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'document.pdf',
      };

      await expect(service.upload(dto, FREELANCER)).resolves.toBeDefined();
    });

    it('should accept valid PNG file based on magic bytes', async () => {
      // PNG magic bytes: \x89PNG\r\n\x1a\n
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const base64Content = pngBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'image.png',
      };

      await expect(service.upload(dto, FREELANCER)).resolves.toBeDefined();
    });

    it('should accept valid JPEG file based on magic bytes', async () => {
      // JPEG magic bytes: \xFF\xD8\xFF
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const base64Content = jpegBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'photo.jpg',
      };

      await expect(service.upload(dto, FREELANCER)).resolves.toBeDefined();
    });

    it('should accept valid ZIP file based on magic bytes', async () => {
      // ZIP magic bytes: PK\x03\x04
      const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const base64Content = zipBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'archive.zip',
      };

      await expect(service.upload(dto, FREELANCER)).resolves.toBeDefined();
    });

    it('should reject executable file disguised as PDF', async () => {
      // Windows PE executable magic bytes: MZ
      const exeBuffer = Buffer.from('MZ' + '\x00'.repeat(100));
      const base64Content = exeBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'malicious.pdf',
      };

      await expect(service.upload(dto, FREELANCER)).rejects.toThrow(BadRequestException);
      await expect(service.upload(dto, FREELANCER)).rejects.toThrow(/not allowed/);
    });

    it('should reject shell script disguised as image', async () => {
      const scriptBuffer = Buffer.from('#!/bin/bash\nrm -rf /');
      const base64Content = scriptBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'image.png',
      };

      await expect(service.upload(dto, FREELANCER)).rejects.toThrow(BadRequestException);
    });

    it('should reject file with unknown/unsupported MIME type', async () => {
      // Random bytes that don't match any known file signature
      const unknownBuffer = Buffer.from([0xab, 0xcd, 0xef, 0x12, 0x34, 0x56]);
      const base64Content = unknownBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'unknown.bin',
      };

      await expect(service.upload(dto, FREELANCER)).rejects.toThrow(BadRequestException);
      await expect(service.upload(dto, FREELANCER)).rejects.toThrow(/Unable to determine file type/);
    });

    it('should reject HTML file disguised as PDF', async () => {
      const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body>XSS</body></html>');
      const base64Content = htmlBuffer.toString('base64');

      const dto = {
        gigId: 'gig-1',
        freelancer: FREELANCER,
        content: base64Content,
        filename: 'document.pdf',
      };

      await expect(service.upload(dto, FREELANCER)).rejects.toThrow(BadRequestException);
    });
  });
});
