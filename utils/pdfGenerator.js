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
               .text('OUR LADY OF LOURDES COLLEGE FOUNDATION', 0, 50, { align: 'center' });

            doc.fillColor('#6c757d').font('Helvetica').fontSize(9)
               .text('Daet, Camarines Norte • Office of Extension Services & Community Involvement', 0, 67, { align: 'center' });

            doc.fillColor('#0d6efd').font('Helvetica-Bold').fontSize(10)
               .text('IN PARTNERSHIP WITH LGU VINZONS, CAMARINES NORTE', 0, 81, { align: 'center' });

            doc.moveTo(150, 98).lineTo(width - 150, 98).lineWidth(1).strokeColor('#dee2e6').stroke();

            // --- 3. CERTIFICATE TITLE ---
            doc.fillColor('#0a58ca').font('Helvetica-Bold').fontSize(26)
               .text('CERTIFICATE OF COMPLETION', 0, 112, { align: 'center' });

            doc.fillColor('#495057').font('Helvetica-Oblique').fontSize(11)
               .text('This certificate is proudly presented to', 0, 148, { align: 'center' });

            // --- 4. STUDENT NAME & PROGRAM ---
            const studentNameUpper = (certData.studentName || 'STUDENT VOLUNTEER').toUpperCase();
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(22)
               .text(studentNameUpper, 0, 170, { align: 'center' });

            doc.moveTo(220, 196).lineTo(width - 220, 196).lineWidth(1.5).strokeColor('#0d6efd').stroke();

            doc.fillColor('#6c757d').font('Helvetica-Bold').fontSize(10)
               .text(`Academic Program: ${certData.course || 'OLLCF Student'}`, 0, 204, { align: 'center' });

            // --- 5. CITATION & SERVICE HOURS ---
            doc.fillColor('#212529').font('Helvetica').fontSize(10.5)
               .text(
                   'for actively participating in and successfully completing the required service hours for the community extension program entitled:',
                   100, 228, { align: 'center', width: width - 200 }
               );

            doc.fillColor('#0d6efd').font('Helvetica-Bold').fontSize(15)
               .text(`"${certData.activityTitle || 'Community Extension Project'}"`, 80, 256, { align: 'center', width: width - 160 });

            doc.fillColor('#495057').font('Helvetica').fontSize(10)
               .text(
                   `conducted at ${certData.location || 'Vinzons, Camarines Norte'} on ${certData.targetDate || 'N/A'}, rendering a total of`,
                   100, 284, { align: 'center', width: width - 200 }
               );

            const hoursVal = parseFloat(certData.hoursRendered || 0).toFixed(2);
            doc.fillColor('#198754').font('Helvetica-Bold').fontSize(12.5)
               .text(`${hoursVal} Validated Community Service Hours`, 0, 302, { align: 'center' });

            // --- 6. QR CODE VERIFICATION ---
            try {
                const qrUrl = `https://collabnet-live.onrender.com/verify-certificate/${certData.certNo}`;
                const qrDataUrl = await QRCode.toDataURL(qrUrl);
                doc.image(qrDataUrl, 50, 420, { fit: [75, 75] });
            } catch (e) {
                console.warn('QR Code generation skipped:', e.message);
            }

            doc.fillColor('#495057').font('Helvetica-Bold').fontSize(8)
               .text(`Ref. No: ${certData.certNo}`, 40, 502, { width: 95, align: 'center' });
            doc.font('Helvetica').fontSize(7)
               .text('Scan QR to verify on CollabNet', 40, 514, { width: 95, align: 'center' });

            // --- 7. CLEAN & PROPERLY ALIGNED SIGNATURE BLOCKS ---
            const sigLineY = 460;
            const sigTextY = 467;
            const subTextY = 482;

            // Signature Block 1: LGU Representative (Left)
            const col1X = 175;
            const col1Width = 170;
            doc.moveTo(col1X, sigLineY).lineTo(col1X + col1Width, sigLineY).lineWidth(1).strokeColor('#495057').stroke();
            doc.fillColor('#212529').font('Helvetica-Bold').fontSize(9.5)
               .text('HON. MUNICIPAL MAYOR', col1X, sigTextY, { width: col1Width, align: 'center' });
            doc.fillColor('#6c757d').font('Helvetica').fontSize(8)
               .text('LGU Vinzons, Camarines Norte', col1X, subTextY, { width: col1Width, align: 'center' });

            // Signature Block 2: OLLCF Extension Director (Center)
            const col2X = 385;
            const col2Width = 180;
            doc.moveTo(col2X, sigLineY).lineTo(col2X + col2Width, sigLineY).lineWidth(1).strokeColor('#495057').stroke();
            doc.fillColor('#212529').font('Helvetica-Bold').fontSize(9.5)
               .text('EXTENSION SERVICES DIRECTOR', col2X, sigTextY, { width: col2Width, align: 'center' });
            doc.fillColor('#6c757d').font('Helvetica').fontSize(8)
               .text('Our Lady of Lourdes College Foundation', col2X, subTextY, { width: col2Width, align: 'center' });

            // Signature Block 3: VP for Academic Affairs (Right)
            const col3X = 605;
            const col3Width = 170;
            doc.moveTo(col3X, sigLineY).lineTo(col3X + col3Width, sigLineY).lineWidth(1).strokeColor('#495057').stroke();
            doc.fillColor('#212529').font('Helvetica-Bold').fontSize(9.5)
               .text('VP FOR ACADEMIC AFFAIRS', col3X, sigTextY, { width: col3Width, align: 'center' });
            doc.fillColor('#6c757d').font('Helvetica').fontSize(8)
               .text('OLLCF Daet', col3X, subTextY, { width: col3Width, align: 'center' });

            // Footer Issuance Notice
            doc.fillColor('#6c757d').font('Helvetica-Oblique').fontSize(8)
               .text(`Issued on ${certData.issueDate} via CollabNet Platform`, 0, 545, { align: 'center' });

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generateCertificatePDF };