import PDFDocument from 'pdfkit'

/**
 * Builds a streamable consolidated health report PDF adhering strictly to the caller's authorized sections.
 * 
 * @param {Object} options
 * @param {Object} options.patient - Patient record data
 * @param {Object} options.sections - Authorized sections boolean flags from sectionsFor(scope)
 * @param {Object} options.grant - Grant metadata ({ via, scope })
 * @param {Array}  options.documents - Authorized medical documents metadata
 * @param {Object} options.caller - User object requesting the report ({ id, role, email, displayName })
 * @returns {Promise<Buffer>} Resolves to PDF Buffer
 */
export function generateConsolidatedReportPdf({
  patient,
  sections,
  grant,
  documents = [],
  caller,
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
          Title: `CareCrypt Health Record - ${patient.mrn}`,
          Author: 'CareCrypt Privacy Platform',
          Subject: 'Consolidated Longitudinal Health Record',
          Keywords: 'CareCrypt, Medical Report, EHR, Longitudinal',
        },
      })

      const chunks = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err) => reject(err))

      const primaryTeal = '#0f766e'
      const darkSlate = '#1e293b'
      const mutedText = '#64748b'
      const lightBorder = '#cbd5e1'
      const alertRed = '#dc2626'
      const boxBg = '#f8fafc'

      // ── Header ─────────────────────────────────────────────────────────────
      doc
        .rect(40, 40, doc.page.width - 80, 50)
        .fill(primaryTeal)

      doc
        .fillColor('#ffffff')
        .fontSize(18)
        .font('Helvetica-Bold')
        .text('CareCrypt Health Record', 55, 48)

      doc
        .fontSize(9)
        .font('Helvetica')
        .text('CONSOLIDATED LONGITUDINAL HEALTH REPORT', 55, 70)

      doc
        .fillColor('#ffffff')
        .fontSize(9)
        .font('Helvetica')
        .text(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, doc.page.width - 250, 52, {
          width: 195,
          align: 'right',
        })
        .text(`Access Scope: ${grant.scope} (${grant.via})`, doc.page.width - 250, 68, {
          width: 195,
          align: 'right',
        })

      doc.moveDown(2.5)

      // ── Patient Identification Banner ──────────────────────────────────────
      const d = patient.demographics || {}
      doc.y = 105

      doc
        .rect(40, doc.y, doc.page.width - 80, 60)
        .fillAndStroke(boxBg, lightBorder)

      doc
        .fillColor(darkSlate)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(d.fullName || 'Unknown Patient', 55, 115)

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(mutedText)
        .text(`MRN: ${patient.mrn || 'N/A'}    |    Age: ${d.ageYears ?? 'N/A'} yrs    |    Gender: ${d.gender ?? 'N/A'}    |    Blood Group: ${d.bloodGroup ?? 'N/A'}`, 55, 133)

      if (sections.contactDetails && d.contact) {
        doc.text(
          `Phone: ${d.contact.phone || 'N/A'}    |    Address: ${d.location?.addressLine || ''}, ${d.location?.city || ''}, ${d.location?.state || ''} ${d.location?.pincode || ''}`,
          55,
          148,
        )
      } else {
        doc.text(
          `Location: ${d.location?.city || 'N/A'}, ${d.location?.district || ''}, ${d.location?.state || ''}  [Detailed contact restricted by consent]`,
          55,
          148,
        )
      }

      doc.y = 180

      // ── Helper to draw section titles ──────────────────────────────────────
      function drawSectionTitle(title, badge = null) {
        checkPageBreak(40)
        doc
          .fillColor(primaryTeal)
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(title.toUpperCase(), 40, doc.y)
        if (badge) {
          doc
            .fontSize(8)
            .font('Helvetica-Bold')
            .fillColor(alertRed)
            .text(`[${badge}]`, doc.x + 10, doc.y - 10)
        }
        doc
          .moveTo(40, doc.y + 4)
          .lineTo(doc.page.width - 40, doc.y + 4)
          .strokeColor(lightBorder)
          .stroke()
        doc.y += 10
      }

      function checkPageBreak(neededHeight) {
        if (doc.y + neededHeight > doc.page.height - 50) {
          doc.addPage()
          doc.y = 50
        }
      }

      // ── Section 1: Known Allergies ─────────────────────────────────────────
      drawSectionTitle('1. Allergies & Adverse Drug Reactions')
      const allergies = patient.allergies || []
      if (allergies.length === 0) {
        doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('No drug or environmental allergies recorded in database.', 45, doc.y)
        doc.y += 12
      } else {
        for (const a of allergies) {
          checkPageBreak(25)
          doc
            .fillColor(a.severity === 'SEVERE' || a.severity === 'LIFE_THREATENING' ? alertRed : darkSlate)
            .fontSize(9)
            .font('Helvetica-Bold')
            .text(`• ${a.allergen} (${a.type || 'ALLERGY'})`, 45, doc.y)
          doc
            .font('Helvetica')
            .fillColor(mutedText)
            .text(`  Severity: ${a.severity}  |  Reaction: ${a.reaction || 'None detailed'}  |  Recorded: ${a.recordedAt ? a.recordedAt.slice(0, 10) : 'N/A'}`)
          doc.y += 4
        }
      }
      doc.y += 10

      // ── Section 2: Chronic Conditions / Problem List ───────────────────────
      drawSectionTitle('2. Active & Chronic Conditions')
      const conditions = patient.chronicConditions || []
      if (conditions.length === 0) {
        doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('No active chronic conditions recorded in problem list.', 45, doc.y)
        doc.y += 12
      } else {
        for (const c of conditions) {
          checkPageBreak(25)
          doc
            .fillColor(darkSlate)
            .fontSize(9)
            .font('Helvetica-Bold')
            .text(`• [${c.code}] ${c.name}`, 45, doc.y)
          doc
            .font('Helvetica')
            .fillColor(mutedText)
            .text(`  Status: ${c.status}  |  Onset: ${c.onsetDate || 'Unknown'}  |  Notes: ${c.notes || 'None'}`)
          doc.y += 4
        }
      }
      doc.y += 10

      // ── Section 3: Active Medications ──────────────────────────────────────
      drawSectionTitle('3. Current Active Medications')
      const meds = patient.medications?.active || []
      if (meds.length === 0) {
        doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('No ongoing active prescriptions recorded.', 45, doc.y)
        doc.y += 12
      } else {
        for (const m of meds) {
          checkPageBreak(25)
          doc
            .fillColor(darkSlate)
            .fontSize(9)
            .font('Helvetica-Bold')
            .text(`• ${m.name} (${m.dose || ''}) - ${m.frequency || ''}`, 45, doc.y)
          doc
            .font('Helvetica')
            .fillColor(mutedText)
            .text(`  Route: ${m.route || 'ORAL'}  |  Prescribed by: ${m.prescribedBy || 'Clinician'}  |  Course Ends: ${m.endsAt ? m.endsAt.slice(0, 10) : 'Ongoing'}`)
          doc.y += 4
        }
      }
      doc.y += 10

      // ── Section 4: Consultations & Longitudinal Visits ─────────────────────
      if (sections.visitHistory) {
        drawSectionTitle('4. Consultations & Longitudinal Visits')
        const visits = patient.visitHistory || []
        if (visits.length === 0) {
          doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('No clinical visits recorded in timeline.', 45, doc.y)
          doc.y += 12
        } else {
          for (const v of visits) {
            checkPageBreak(65)
            const vDate = v.date ? v.date.slice(0, 10) : 'Date Unknown'
            doc
              .fillColor(darkSlate)
              .fontSize(9.5)
              .font('Helvetica-Bold')
              .text(`Visit Date: ${vDate}  —  ${v.type || 'OPD'} (${v.facility?.name || 'CareCrypt Facility'})`, 45, doc.y)

            const clin = v.clinician?.name || 'Attending Clinician'
            const spec = v.clinician?.specialty ? ` (${v.clinician.specialty})` : ''
            doc.font('Helvetica').fontSize(8.5).fillColor(mutedText).text(`Clinician: ${clin}${spec}`)

            if (v.vitals) {
              const vit = []
              if (v.vitals.bloodPressure) vit.push(`BP: ${v.vitals.bloodPressure.systolic}/${v.vitals.bloodPressure.diastolic} mmHg`)
              if (v.vitals.pulseBpm) vit.push(`Pulse: ${v.vitals.pulseBpm} bpm`)
              if (v.vitals.temperatureC) vit.push(`Temp: ${v.vitals.temperatureC} °C`)
              if (v.vitals.spo2Percent) vit.push(`SpO2: ${v.vitals.spo2Percent}%`)
              if (vit.length > 0) {
                doc.text(`Vitals: ${vit.join('  |  ')}`)
              }
            }

            if (v.diagnoses && v.diagnoses.length > 0) {
              const dxList = v.diagnoses.map((d) => `${d.name} [${d.code}]${d.isPrimary ? ' (Primary)' : ''}`).join(', ')
              doc.text(`Diagnoses: ${dxList}`)
            }

            if (v.notes) {
              doc.text(`Notes: ${v.notes}`)
            }

            doc.y += 8
          }
        }
      } else {
        drawSectionTitle('4. Consultations & Longitudinal Visits')
        doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('Consultation and visit history withheld (outside active consent scope: SUMMARY_ONLY).', 45, doc.y)
        doc.y += 12
      }
      doc.y += 10

      // ── Section 5: Medical Documents & Uploads ──────────────────────────────
      if (sections.visitHistory) {
        drawSectionTitle('5. Attached Medical Documents & Scans')
        if (documents.length === 0) {
          doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('No external lab reports, X-rays or document files attached.', 45, doc.y)
          doc.y += 12
        } else {
          for (const docItem of documents) {
            checkPageBreak(30)
            doc
              .fillColor(darkSlate)
              .fontSize(9)
              .font('Helvetica-Bold')
              .text(`• [${docItem.documentType}] ${docItem.originalFileName}`, 45, doc.y)
            doc
              .font('Helvetica')
              .fontSize(8.5)
              .fillColor(mutedText)
              .text(`  Size: ${Math.round(docItem.fileSizeBytes / 1024)} KB  |  Uploaded: ${docItem.createdAt ? docItem.createdAt.slice(0, 10) : 'N/A'}  |  SHA-256: ${docItem.sha256Checksum ? docItem.sha256Checksum.slice(0, 16) + '...' : 'Verified'}`)
            doc.y += 4
          }
        }
      } else {
        drawSectionTitle('5. Attached Medical Documents & Scans')
        doc.fillColor(mutedText).fontSize(9).font('Helvetica-Oblique').text('Medical document references withheld (outside active consent scope).', 45, doc.y)
        doc.y += 12
      }

      // ── Verification & Attestation Footer ───────────────────────────────────
      checkPageBreak(70)
      doc.moveDown(1.5)
      doc
        .rect(40, doc.y, doc.page.width - 80, 50)
        .fillAndStroke('#f1f5f9', lightBorder)

      const footerY = doc.y + 8
      doc
        .fillColor(darkSlate)
        .fontSize(8.5)
        .font('Helvetica-Bold')
        .text('System Provenance & Access Audit Notice', 50, footerY)

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(mutedText)
        .text(
          `This document was dynamically compiled from authorized database entries in CareCrypt. ` +
          `Generated by caller ${caller?.role || 'USER'} (${caller?.email || 'authenticated session'}). ` +
          `Every view and export of this record is recorded in the append-only cryptographic audit chain. ` +
          `Do not share without valid patient authorization.`,
          50,
          footerY + 12,
          { width: doc.page.width - 100 },
        )

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
