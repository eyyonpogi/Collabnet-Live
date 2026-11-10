// utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

/**
 * Generates an Official OLLCF x LGU Vinzons Certificate of Completion PDF Stream
 */
async function generateCertificatePDF(certData) {
    return new Promise(async (resolve, reject) => {
        try {
            // Create A4 Landscape Document (841.89 x 595.28 pt)
            const doc = new PDFDocument({
                size: 'A4',
                layout: 'landscape',
                margin: 0
            });

            const buffers = [];
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', err => reject(err));

            const width = 841.89;
            const height = 595.28;

            // --- 1. BORDER & BACKGROUND STYLING ---
            doc.rect(20, 20, width - 40, height - 40).lineWidth(3).strokeColor('#0d6efd').stroke();
            doc.rect(26, 26, width - 52, height - 52).lineWidth(1).strokeColor('#ffc107').stroke();
            doc.rect(27, 27, width - 54, 8).fillColor('#0d6efd').fill();

            // --- 2. HEADER & INSTITUTIONAL BRANDING ---
            doc.fillColor('#1a252f').font('Helvetica-Bold').fontSize(12)
               .text('OUR LADY OF LOURDES COLLEGE FOUNDATION', 0, 55, { align: 'center' });

            doc.fillColor('#6c757d').font('Helvetica').fontSize(9)
               .text('Daet, Camarines Norte • Office of Extension Services & Community Involvement', 0, 72, { align: 'center' });

            doc.fillColor('#0d6efd').font('Helvetica-Bold').fontSize(10)
               .text('IN PARTNERSHIP WITH LGU VINZONS, CAMARINES NORTE', 0, 86, { align: 'center' });

            doc.moveTo(150, 104).lineTo(width - 150, 104).lineWidth(1).strokeColor('#dee2e6').stroke();

            // --- 3. CERTIFICATE TITLE ---
            doc.fillColor('#0a58ca').font('Helvetica-Bold').fontSize(28)
               .text('CERTIFICATE OF COMPLETION', 0, 120, { align: 'center' });

            doc.fillColor('#495057').font('Helvetica-Oblique').fontSize(11)
               .text('This certificate is proudly presented to', 0, 158, { align: 'center' });

            // --- 4. STUDENT NAME & PROGRAM ---
            const studentNameUpper = (certData.studentName || 'STUDENT VOLUNTEER').toUpperCase();
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(24)
               .text(studentNameUpper, 0, 182, { align: 'center' });

            doc.moveTo(220, 210).lineTo(width - 220, 210).lineWidth(1.5).strokeColor('#0d6efd').stroke();

            doc.fillColor('#6c757d').font('Helvetica-Bold').fontSize(11)
               .text(`Academic Program: ${certData.course || 'OLLCF Student'}`, 0, 218, { align: 'center' });

            // --- 5. CITATION & SERVICE HOURS ---
            doc.fillColor('#212529').font('Helvetica').fontSize(11)
               .text(
                   'for actively participating in and successfully completing the required service hours for the community extension program entitled:',
                   100, 245, { align: 'center', width: width - 200 }
               );

            doc.fillColor('#0d6efd').font('Helvetica-Bold').fontSize(15)
               .text(`"${certData.activityTitle || 'Community Extension Project'}"`, 80, 275, { align: 'center', width: width - 160 });

            doc.fillColor('#495057').font('Helvetica').fontSize(10)
               .text(
                   `conducted at ${certData.location || 'Vinzons, Camarines Norte'} on ${certData.targetDate || 'N/A'}, rendering a total of`,
                   100, 305, { align: 'center', width: width - 200 }
               );

            const hoursVal = parseFloat(certData.hoursRendered || 0).toFixed(2);
            doc.fillColor('#198754').font('Helvetica-Bold').fontSize(13)
               .text(`${hoursVal} Validated Community Service Hours`, 0, 323, { align: 'center' });

            // --- 6. QR CODE VERIFICATION ---
            try {
                const qrUrl = `https://collabnet-live.onrender.com/verify-certificate/${certData.certNo}`;
                const qrDataUrl = await QRCode.toDataURL(qrUrl);
                doc.image(qrDataUrl, 55, 435, { fit: [80, 80] });
            } catch (e) {
                console.warn('QR Code generation skipped:', e.message);
            }

            doc.fillColor('#495057').font('Helvetica-Bold').fontSize(8)
               .text(`Ref. No: ${certData.certNo}`, 45, 520, { width: 100, align: 'center' });
            doc.font('Helvetica').fontSize(7)
               .text('Scan QR to verify on CollabNet', 45, 532, { width: 100, align: 'center' });

            // --- 7. OFFICIAL SIGNATURE BLOCKS ---
            const sigY = 445;

            // LGU Representative
            doc.moveTo(220, sigY + 40).lineTo(380, sigY + 40).lineWidth(1).strokeColor('#495057').stroke();
            doc.fillColor('#212529').font('Helvetica-Bold').fontSize(10).text('HON. MUNICIPAL MAYOR', 220, sigY + 45, { width: 160, align: 'center' });
            doc.fillColor('#6c757d').font('Helvetica').fontSize(8).text('LGU Vinzons, Camarines Norte', 220, sigY + 58, { width: 160, align: 'center' });

            // OLLCF Extension Director
            doc.moveTo(460, sigY + 40).lineTo(620, sigY + 40).lineWidth(1).strokeColor('#495057').stroke();
            doc.fillColor('#212529').font('Helvetica-Bold').fontSize(10).text('EXTENSION SERVICES DIRECTOR', 460, sigY + 45, { width: 160, align: 'center' });
            doc.fillColor('#6c757d').font('Helvetica').fontSize(8).text('Our Lady of Lourdes College Foundation', 460, sigY + 58, { width: 160, align: 'center' });

            // Academic Dean / VP
            doc.moveTo(660, sigY + 40).lineTo(780, sigY + 40).lineWidth(1).strokeColor('#495057').stroke();
            doc.fillColor('#212529').font('Helvetica-Bold').fontSize(10).text('VP FOR ACADEMIC AFFAIRS', 660, sigY + 45, { width: 120, align: 'center' });
            doc.fillColor('#6c757d').font('Helvetica').fontSize(8).text('OLLCF Daet', 660, sigY + 58, { width: 120, align: 'center' });

            // Footer Timestamp
            doc.fillColor('#6c757d').font('Helvetica-Oblique').fontSize(8)
               .text(`Issued on ${certData.issueDate} via CollabNet Platform`, 0, 555, { align: 'center' });

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generateCertificatePDF };