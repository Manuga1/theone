/**
 * Builds Padma's two hosted forms in one run, exactly as docs/gtm/form-fields.md describes them:
 *   1. "Join the Padma registry"   → its own private sheet "Padma registry"
 *   2. "Talk to Padma about a pilot" → its own private sheet "Padma pilot enquiries"
 * and prints the two embed addresses to paste into Vercel (VITE_REGISTRY_FORM_URL, VITE_PILOT_FORM_URL).
 *
 * How to run (about 3 minutes):
 *   1. Sign in to the Google account made for Padma (two-factor sign-in on). Not a university or VUMC account.
 *   2. Open https://script.google.com → New project. Delete the sample code and paste this whole file.
 *   3. Fill in CONTACT_EMAIL below (the address people write to in order to leave). SECOND_PERSON_EMAIL is optional:
 *      the one other person allowed to open the sheets, by their own account.
 *   4. Choose createPadmaForms in the function menu and press Run. Google asks you to authorise the script: it is your
 *      own script, so choose your account, then "Advanced" → "Go to … (unsafe)" → Allow.
 *   5. Open "Execution log". Copy the two embed addresses into Vercel, then redeploy.
 *
 * The script asks no health questions, adds no tracking, collects no email addresses automatically and shares nothing
 * except the sheets with SECOND_PERSON_EMAIL (if set). Running it twice is refused, so you never get duplicate forms.
 */

const SITE_URL = 'https://theone-snowy.vercel.app'; // change when the Padma domain is live
const CONTACT_EMAIL = ''; // REQUIRED: the leave-and-delete address, e.g. on the Padma domain
const SECOND_PERSON_EMAIL = ''; // optional: the second named person who may open both sheets

const REGISTRY_TITLE = 'Join the Padma registry';
const PILOT_TITLE = 'Talk to Padma about a pilot';

const STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas',
  'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

function createPadmaForms() {
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(CONTACT_EMAIL)) {
    throw new Error('Fill in CONTACT_EMAIL at the top of the script first. The registry promises a leave-and-delete address.');
  }
  for (const title of [REGISTRY_TITLE, PILOT_TITLE]) {
    if (DriveApp.getFilesByName(title).hasNext()) {
      throw new Error('A file called "' + title + '" already exists in this Drive. Nothing was created. Delete or rename it first if you really want to rebuild.');
    }
  }

  const registry = buildRegistryForm_();
  const registrySheet = linkPrivateSheet_(registry, 'Padma registry', ['known_to_founders', 'age_rule_ok', 'check_in_sent', 'check_in_answered']);
  const pilot = buildPilotForm_();
  const pilotSheet = linkPrivateSheet_(pilot, 'Padma pilot enquiries', []);

  console.log('Done. Paste these into Vercel → Settings → Environment Variables → Production, then redeploy:');
  console.log('VITE_REGISTRY_FORM_URL = ' + embedUrl_(registry));
  console.log('VITE_PILOT_FORM_URL    = ' + embedUrl_(pilot));
  console.log('VITE_CONTACT_EMAIL     = ' + CONTACT_EMAIL);
  console.log('Registry sheet (private): ' + registrySheet.getUrl());
  console.log('Pilot sheet (private):    ' + pilotSheet.getUrl());
  console.log('Next: open each embed address in a private browser window; it must load without asking you to sign in.');
}

// ---------------------------------------------------------------------------------------------------------------
// Form 1: registry sign-up (form-fields.md, "Form 1"). Contact details only. No health questions, no free-text box.

function buildRegistryForm_() {
  const form = FormApp.create(REGISTRY_TITLE);
  form.setDescription(
    'Padma is a student project. It keeps a list of adults who are willing to be invited to research studies. ' +
    'This form takes about two minutes. It asks for contact details only. Please do not tell us anything about your health.'
  );
  form.addSectionHeaderItem()
    .setTitle('Before you join')
    .setHelpText([
      '• Padma is a student project. It is not a company, and it is not affiliated with or endorsed by Vanderbilt University or Vanderbilt University Medical Center.',
      '• Joining puts you on a list. It does not put you in a study.',
      '• We will email you when a study might fit you. We may also send an occasional short check-in to keep your details up to date. We will never ask about your health in the registry.',
      '• Each study has its own consent form and states its pay before you decide. Nothing is guaranteed: not an invitation, not a place in a study, not a payment.',
      '• We never sell your details. A study team receives them only if you say yes to that study.',
      '• You can leave at any time. Email ' + CONTACT_EMAIL + ' and we delete your details within 7 days.',
      '• You must live in the US and be 18 or older (19 or older in Alabama and Nebraska, 21 or older in Mississippi).',
      '• Please do not send us any health information.',
    ].join('\n'));

  form.addTextItem().setTitle('Your name').setHelpText('First and last name').setRequired(true);
  form.addTextItem()
    .setTitle('Your email address')
    .setHelpText('We use this only to write to you about the registry and about studies that might fit you')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText('Please enter an email address.').requireTextIsEmail().build());
  form.addMultipleChoiceItem()
    .setTitle('Your age band')
    .setHelpText('You must be 18 or older (19 or older in Alabama and Nebraska, 21 or older in Mississippi)')
    .setChoiceValues(['18', '19–20', '21–29', '30–39', '40–49', '50–59', '60–69', '70 or older'])
    .setRequired(true);
  form.addListItem()
    .setTitle('The state you live in')
    .setHelpText('Your home state. US residents only')
    .setChoiceValues(STATES)
    .setRequired(true);
  form.addListItem()
    .setTitle('The state you would be in during a study')
    .setHelpText('Students and people who travel: where will you be for the next few months?')
    .setChoiceValues(STATES.concat(['Not sure yet']))
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('Devices you own')
    .setHelpText('Tick all that apply. This only tells us which studies could fit you')
    .setChoiceValues(['iPhone', 'Android phone', 'Apple Watch', 'Fitbit', 'Oura ring', 'Garmin watch',
      'Another fitness tracker or smartwatch', 'None of these'])
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('Kinds of study you would consider')
    .setHelpText('Tick all that apply. You decide again for each study')
    .setChoiceValues(['Online surveys', 'A short daily check-in for one or two weeks',
      'Taking photos of meals for one or two weeks', 'Sharing data from a wearable I already own',
      'A video or phone interview', 'Using a device that the research team sends me', 'An in-person visit near where I live'])
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('I am old enough to join in my state, and I live in the United States')
    .setChoiceValues(['Yes'])
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('I have read the registry privacy notice and agree to be emailed by Padma about research studies I might join')
    .setHelpText('The registry privacy notice: ' + SITE_URL + '/privacy')
    .setChoiceValues(['Yes'])
    .setRequired(true);

  form.setConfirmationMessage(
    'Thank you. You are on the Padma registry. Joining does not put you in a study, and nothing is guaranteed. ' +
    'To leave, email ' + CONTACT_EMAIL + ' and we will delete your details within 7 days.'
  );
  applyQuietSettings_(form);
  return form;
}

// ---------------------------------------------------------------------------------------------------------------
// Form 2: pilot enquiry (form-fields.md, "Form 2"). No prices, no budget question.

function buildPilotForm_() {
  const form = FormApp.create(PILOT_TITLE);
  form.setDescription(
    'Padma is a student project in pilot stage. It has no enrolled participants yet. Tell us a little about your study ' +
    'and we will reply by email to arrange a 20-minute call. Please do not include information about any individual person.'
  );
  form.addTextItem().setTitle('Your name').setRequired(true);
  form.addTextItem()
    .setTitle('Work email')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText('Please enter an email address.').requireTextIsEmail().build());
  form.addTextItem().setTitle('Organisation').setHelpText('Company, university or institute').setRequired(true);
  form.addTextItem()
    .setTitle('Your role')
    .setHelpText('For example: principal investigator, study coordinator, founder, clinical lead')
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Type of organisation')
    .setChoiceValues(['Company', 'University or academic medical centre', 'Non-profit or foundation', 'Other'])
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('What would you like help with?')
    .setHelpText('Tick all that apply')
    .setChoiceValues(['Sending our approved study notice to people who opted in',
      'A small pilot group on a simple 14-day protocol', 'A design-partner pilot with a weekly call',
      'One more measurement from participants we already have', 'Not sure yet'])
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('In a sentence or two, what do you want to measure?')
    .setHelpText('Measures and schedule only. Nothing about individual people')
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Roughly how many participants?')
    .setChoiceValues(['10 or fewer', '11–25', '26–50', 'More than 50', 'Not sure'])
    .setRequired(false);
  form.addMultipleChoiceItem()
    .setTitle('When would you like to start?')
    .setChoiceValues(['Within 1 month', '1–3 months', '3–6 months', 'Later, or just exploring'])
    .setRequired(false);
  form.addMultipleChoiceItem()
    .setTitle('Ethics cover for this work')
    .setHelpText("We can only work under your approved protocol, or under your counsel's written view")
    .setChoiceValues(['We hold an approved protocol', 'Our protocol is in review',
      'Our counsel treats this as product feedback, not research', 'None yet', 'Not sure'])
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Would you want the option to contact the same participants again later?')
    .setChoiceValues(['Yes', 'Maybe', 'No'])
    .setRequired(false);
  form.addParagraphTextItem()
    .setTitle('Anything else we should know?')
    .setHelpText('Please do not include information about any individual person')
    .setRequired(false);

  form.setConfirmationMessage(
    'Thank you. We will reply by email to arrange a call. Padma is a student project in pilot stage and has no enrolled participants yet.'
  );
  applyQuietSettings_(form);
  return form;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared settings: anyone can answer without signing in; nothing is collected beyond the answers; no answer summary,
// no "submit another response" link, no edits after submitting, no copy of answers emailed back.

function applyQuietSettings_(form) {
  tryCall_(form, 'setEmailCollectionType', FormApp.EmailCollectionType ? FormApp.EmailCollectionType.DO_NOT_COLLECT : undefined);
  tryCall_(form, 'setCollectEmail', false);
  tryCall_(form, 'setRequireLogin', false); // Google Workspace accounts only; consumer accounts never require sign-in
  tryCall_(form, 'setLimitOneResponsePerUser', false); // limiting would force respondents to sign in
  form.setAllowResponseEdits(false);
  form.setPublishingSummary(false);
  form.setShowLinkToRespondAgain(false);
  form.setProgressBar(false);
  form.setAcceptingResponses(true);
  tryCall_(form, 'setPublished', true); // newer accounts create forms unpublished
  DriveApp.getFileById(form.getId()).setShareableByEditors(false);
}

/** Links the form to a new spreadsheet, adds the founders' working columns, and keeps the sheet private. */
function linkPrivateSheet_(form, name, extraColumns) {
  const ss = SpreadsheetApp.create(name);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  Utilities.sleep(2000); // the response tab appears a moment after linking

  const linked = SpreadsheetApp.openById(ss.getId());
  const responses = linked.getSheets().filter(function (s) { return s.getFormUrl(); })[0];
  linked.getSheets().forEach(function (s) {
    if (responses && s.getSheetId() !== responses.getSheetId() && linked.getSheets().length > 1) linked.deleteSheet(s);
  });
  if (responses && extraColumns.length > 0) {
    responses.getRange(1, responses.getLastColumn() + 1, 1, extraColumns.length).setValues([extraColumns]);
  }

  const file = DriveApp.getFileById(ss.getId());
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  file.setShareableByEditors(false);
  if (SECOND_PERSON_EMAIL) linked.addEditor(SECOND_PERSON_EMAIL);
  return linked;
}

/** The address that goes inside the site's iframe: the public form link with ?embedded=true. */
function embedUrl_(form) {
  return form.getPublishedUrl().replace(/\?.*$/, '') + '?embedded=true';
}

function tryCall_(obj, method, value) {
  if (typeof obj[method] !== 'function' || value === undefined) return;
  try { obj[method](value); } catch (e) { console.log('Skipped ' + method + ': ' + e.message); }
}
