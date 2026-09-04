/* ─────────────────────────────────────────────────────────────────
   words.js — word lists and quotes.

   Kept in one file so the test can be reseeded without touching the
   engine. The file is a UMD-style wrapper: in the browser it sets
   `window.WORDS`; under Node / the leaderboard worker it is a plain
   CommonJS module, so the server can check that a submitted run really
   was typed on words from these lists.

   Lists:
     english      the English 400, ordered roughly by frequency — the
                  default, and the only list the leaderboard ranks
     english 1k   the thousand most common words, from Peter Norvig's
                  compilation of Google's Web Trillion Word Corpus
                  (norvig.com/ngrams), filtered here to plain letters
     code         keywords, symbols and camelCase for people who type code
   ───────────────────────────────────────────────────────────────── */
(function (root, factory) {
  const W = factory();
  if (typeof module === 'object' && module.exports) module.exports = W;
  if (root) root.WORDS = W;
})(typeof self !== 'undefined' ? self : this, function () {

  const split = s => s.trim().split(/\s+/);
  const dedupe = a => Array.from(new Set(a));

  const english = dedupe(split(`
the be of and a to in he have it that for they i with as not on she at by this we
you do but from or which one would all will there say who make when can more if no man out other
so what time up go about than into could state only new year some take come these know see use get
like then first any work now may such give over think most even find day also after way many must
look before great back through long where much should well people down own just because good each
those feel seem how high too place little world very still nation hand old life tell write become
here show house both between need mean call develop under last right move thing general school never
same another begin while number part turn real leave might want point form off child few small since
against ask late home interest large person end open public follow during present without again hold
govern around possible head consider word program problem however lead system set order eye plan run
keep face fact group play stand increase early course change help line city put close case force meet
once water upon war build hear light unite live every country bring center let side try provide continue
name certain power pay result question study woman member until far night always service away report
something company week church toward start social room figure nature though young less enough almost
read include president nothing yet better big boy cost business value second why clear expect family
complete act sense mind experience art next near direct car law industry important girl god several
matter usual rather per often kind among white reason action return foot care simple within love human
along appear doctor believe speak active student month drive concern best door hope example inform body
ever least probably understand reach effect different idea whole control condition field pass fall note
special talk particular today measure walk teach low hour type carry rate remain full street easy
lot decide friend wait cover song music paper table green summer answer minute quick brown
jump lazy dog quiet ready river stone travel window winter yellow zero heart happy strong
short bright dark clean clever gentle honest sudden useful warm wide wild wise deep`));

  const english1k = dedupe(split(`
the of and to a in for is on that by this with i you it not or be are from at your all have new
more an was we will home can us about if page my has search free but our one other do no
information time they site he up may what which their news out use any there see only so his
when contact here business who web also now help get view online first been would how were me
services some these click its like service than find price date back top people had list name
just over state year day into email two health world next used go work last most products music
buy data make them should product system post her city add policy number such please available
copyright support message after best software then good video well where info rights public
books high school through each links she review years order very privacy book items company read
group need many user said does set under general research university january mail full map
reviews program life know games way days management part could great united hotel real item
international center must store travel comments made development report off member details line
terms before hotels did send right type because local those using results office education
national car design take posted internet address community within states area want phone
shipping reserved subject between forum family long based code show even black check special
prices website index being women much sign file link open today technology south case project
same pages version section own found sports house related security both county american photo
game members power while care network down computer systems three total place end following
download him without per access think north resources current posts big media law control water
history pictures size art personal since including guide shop directory board location change
white text small rating rate government children during return students shopping account times
sites level digital profile previous form events love old john main call hours image department
title description insurance another why shall property class still money quality every listing
content country private little visit save tools low reply customer december compare movies
include college value article york man card jobs provide food source author different press
learn sale around print course job canada process room stock training too credit point join
science men categories advanced west sales look english left team estate box conditions select
photos thread week category note live large gallery table register however june october november
market library really action start series model features air industry plan human provided yes
required second hot accessories cost movie forums march september better say questions july
going medical test friend come server study application cart staff articles san feedback again
play looking issues april never users complete street topic comment financial things working
against standard tax person below mobile less got blog party payment equipment login student let
programs offers legal above recent park stores side act problem red give memory performance
social august quote language story sell options experience rates create key body young america
important field few east paper single age activities club example girls additional password
latest something road gift question changes night hard texas pay four poker status browse issue
range building seller court february always result audio light write war offer blue groups easy
given files event release analysis request china making picture needs possible might
professional yet month major star areas future space committee hand cards problems london
washington meeting become interest child keep enter california share similar garden schools
million added reference companies listed baby learning energy run delivery popular term film
stories put computers journal reports try welcome central images president notice original head
radio until cell color self council away includes track australia discussion archive once others
entertainment agreement format least society months log safety friends sure trade edition cars
messages marketing tell further updated association able having provides david fun already green
studies close common drive specific several gold living collection called short arts lot ask
display limited powered solutions means director daily beach past natural whether due
electronics five upon period planning database says official weather land average done technical
window france pro region island record direct conference environment records district calendar
costs style front statement update parts ever downloads early miles sound resource present
applications either ago document word works material bill written talk federal hosting rules
final tickets thing centre requirements via cheap kids finance true minutes else mark third rock
gifts europe reading topics bad individual tips plus auto cover usually edit together videos
percent fast function fact unit getting global tech meet far economic player projects lyrics
often subscribe submit germany amount watch included feel though bank risk thanks everything
deals various words production commercial james weight town heart advertising received choose
treatment newsletter archives points knowledge magazine error camera girl currently construction
toys registered clear golf receive domain methods chapter makes protection policies loan wide
beauty manager india position taken sort listings models michael known half cases step
engineering florida simple quick none wireless license paul friday lake whole annual published
later basic shows corporate church method purchase customers active response practice hardware
figure materials fire holiday chat enough designed along among death writing speed countries
loss face brand discount higher effects created remember standards oil bit yellow political
increase advertise kingdom base near environmental thought stuff french storage japan doing
loans shoes entry stay nature orders availability africa summary turn mean growth notes agency
king monday european activity copy although drug pics western income force cash employment
overall bay river commission package contents seen players engine port album regional stop
supplies started administration bar institute views plans double dog build screen exchange types
soon lines electronic continue across benefits needed season apply someone held anything printer
condition effective believe organization effect asked mind sunday selection casino lost tour
menu`));

  /* Programmer's set — symbols and camelCase, for the people who type code. */
  const code = dedupe(split(`
const let var function return if else for while class extends import export default async await
try catch throw new this null true false undefined typeof instanceof => === !== && || ?? ?. ... {} [] ()
map filter reduce forEach push pop slice splice length concat join split index key value props state
render useState useEffect fetch then catch resolve reject promise console.log require module exports
def self lambda yield with open print len range list dict set tuple str int float bool None True False
git commit push pull merge rebase branch checkout stash diff log status remote origin main HEAD
npm node python bash sudo mkdir chmod grep sed awk curl ssh docker compose build run exec volume`));

  return {
    english, english1k, code,

    /* name → list, in the order the settings drawer shows them */
    lists: { 'english': english, 'english 1k': english1k, 'code': code },

    punctuation: [',', '.', '.', '.', ';', ':', '!', '?', "'", '-'],

    /* Quotes are credited on the results screen. Short is under sixty
       characters, long is over a hundred and forty. Text is kept to
       typeable ASCII: straight quotes, no em dashes. */
    quotes: [
      { text: "The quick brown fox jumps over the lazy dog.", source: "pangram", length: "short" },
      { text: "Simplicity is the ultimate sophistication.", source: "Leonardo da Vinci", length: "short" },
      { text: "Talk is cheap. Show me the code.", source: "Linus Torvalds", length: "short" },
      { text: "Any sufficiently advanced technology is indistinguishable from magic.", source: "Arthur C. Clarke", length: "medium" },
      { text: "Premature optimization is the root of all evil.", source: "Donald Knuth", length: "short" },
      { text: "Well begun is half done.", source: "Aristotle", length: "short" },
      { text: "Fortune favours the bold.", source: "Virgil", length: "short" },
      { text: "Knowledge is power.", source: "Francis Bacon", length: "short" },
      { text: "The unexamined life is not worth living.", source: "Socrates", length: "short" },
      { text: "I think, therefore I am.", source: "Rene Descartes", length: "short" },
      { text: "Brevity is the soul of wit.", source: "William Shakespeare, Hamlet", length: "short" },
      { text: "All that glisters is not gold.", source: "William Shakespeare, The Merchant of Venice", length: "short" },
      { text: "No man is an island.", source: "John Donne", length: "short" },
      { text: "To be, or not to be, that is the question.", source: "William Shakespeare, Hamlet", length: "short" },
      { text: "The truth is rarely pure and never simple.", source: "Oscar Wilde", length: "short" },
      { text: "Hope is the thing with feathers.", source: "Emily Dickinson", length: "short" },
      { text: "Less is more.", source: "Robert Browning", length: "short" },
      { text: "The only thing we have to fear is fear itself.", source: "Franklin D. Roosevelt", length: "short" },
      { text: "That which does not kill us makes us stronger.", source: "Friedrich Nietzsche", length: "short" },
      { text: "An investment in knowledge pays the best interest.", source: "Benjamin Franklin", length: "short" },
      { text: "Make it work, make it right, make it fast.", source: "Kent Beck", length: "short" },
      { text: "The best way to predict the future is to invent it.", source: "Alan Kay", length: "short" },
      { text: "First, solve the problem. Then, write the code.", source: "John Johnson", length: "short" },
      { text: "A journey of a thousand miles begins with a single step.", source: "Laozi", length: "short" },
      { text: "The secret of getting ahead is getting started.", source: "Mark Twain", length: "short" },
      { text: "The best time to plant a tree was twenty years ago. The second best time is now.", source: "proverb", length: "medium" },
      { text: "Whereof one cannot speak, thereof one must be silent.", source: "Ludwig Wittgenstein", length: "short" },
      { text: "Do or do not. There is no try.", source: "Yoda", length: "short" },

      { text: "It is not enough for code to work. It must also be easy to read and understand, because you will spend far more time reading it than writing it.", source: "Robert C. Martin", length: "long" },
      { text: "Programs must be written for people to read, and only incidentally for machines to execute.", source: "Abelson and Sussman", length: "medium" },
      { text: "A language that doesn't affect the way you think about programming is not worth knowing.", source: "Alan Perlis", length: "medium" },
      { text: "Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.", source: "Antoine de Saint-Exupery", length: "medium" },
      { text: "Speed is a byproduct of accuracy. Nobody ever typed faster by trying to type faster; they typed faster by making fewer mistakes and then, one day, noticing that the same care now took less time.", source: "written for this test", length: "long" },
      { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", source: "Thomas Edison", length: "medium" },
      { text: "Early to bed and early to rise makes a man healthy, wealthy, and wise.", source: "Benjamin Franklin", length: "medium" },
      { text: "Beware of bugs in the above code; I have only proved it correct, not tried it.", source: "Donald Knuth", length: "medium" },
      { text: "Every great developer you know got there by solving problems they were unqualified to solve until they actually did it.", source: "Patrick McKenzie", length: "medium" },
      { text: "Walking on water and developing software from a specification are easy if both are frozen.", source: "Edward V. Berard", length: "medium" },
      { text: "The most damaging phrase in the language is 'We've always done it this way.'", source: "Grace Hopper", length: "medium" },
      { text: "Everything should be made as simple as possible, but not simpler.", source: "attributed to Albert Einstein", length: "medium" },
      { text: "If I have seen further it is by standing on the shoulders of giants.", source: "Isaac Newton", length: "medium" },
      { text: "The man who moves a mountain begins by carrying away small stones.", source: "Confucius", length: "medium" },
      { text: "It does not matter how slowly you go as long as you do not stop.", source: "Confucius", length: "medium" },
      { text: "Whether you think you can, or you think you can't, you're right.", source: "Henry Ford", length: "medium" },
      { text: "Courage is resistance to fear, mastery of fear, not absence of fear.", source: "Mark Twain", length: "medium" },
      { text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", source: "Ralph Waldo Emerson", length: "medium" },
      { text: "Life is really simple, but we insist on making it complicated.", source: "Confucius", length: "medium" },
      { text: "In three words I can sum up everything I've learned about life: it goes on.", source: "Robert Frost", length: "medium" },
      { text: "Two roads diverged in a wood, and I took the one less traveled by, and that has made all the difference.", source: "Robert Frost", length: "medium" },
      { text: "There is nothing either good or bad, but thinking makes it so.", source: "William Shakespeare, Hamlet", length: "medium" },
      { text: "Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.", source: "William Shakespeare, Measure for Measure", length: "medium" },
      { text: "Whatever you can do, or dream you can, begin it. Boldness has genius, power and magic in it.", source: "attributed to Goethe", length: "medium" },
      { text: "You have power over your mind, not outside events. Realize this, and you will find strength.", source: "Marcus Aurelius", length: "medium" },
      { text: "We choose to go to the moon in this decade and do the other things, not because they are easy, but because they are hard.", source: "John F. Kennedy", length: "medium" },
      { text: "The Analytical Engine has no pretensions whatever to originate anything. It can do whatever we know how to order it to perform.", source: "Ada Lovelace", length: "medium" },
      { text: "A ship in harbor is safe, but that is not what ships are built for.", source: "John A. Shedd", length: "medium" },

      { text: "It is a far, far better thing that I do, than I have ever done; it is a far, far better rest that I go to than I have ever known.", source: "Charles Dickens, A Tale of Two Cities", length: "medium" },
      { text: "The reasonable man adapts himself to the world: the unreasonable one persists in trying to adapt the world to himself. Therefore all progress depends on the unreasonable man.", source: "George Bernard Shaw", length: "long" },
      { text: "It is not the critic who counts; not the man who points out how the strong man stumbles, or where the doer of deeds could have done them better. The credit belongs to the man who is actually in the arena, whose face is marred by dust and sweat and blood.", source: "Theodore Roosevelt", length: "long" },
      { text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.", source: "Henry David Thoreau, Walden", length: "long" },
      { text: "It is not that we have a short time to live, but that we waste a lot of it. Life is long enough, and a sufficiently generous amount has been given to us for the highest achievements if it were all well invested.", source: "Seneca", length: "long" },
      { text: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.", source: "Abraham Lincoln", length: "long" },
      { text: "We hold these truths to be self-evident, that all men are created equal, that they are endowed by their Creator with certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness.", source: "The Declaration of Independence", length: "long" },
      { text: "If there is no struggle, there is no progress. Those who profess to favor freedom, and yet deprecate agitation, are men who want crops without plowing up the ground.", source: "Frederick Douglass", length: "long" },
      { text: "The programmer, like the poet, works only slightly removed from pure thought-stuff. He builds his castles in the air, from air, creating by exertion of the imagination.", source: "Fred Brooks", length: "long" },
      { text: "The competent programmer is fully aware of the strictly limited size of his own skull; therefore he approaches the programming task in full humility, and among other things he avoids clever tricks like the plague.", source: "Edsger W. Dijkstra", length: "long" },
      { text: "Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are, by definition, not smart enough to debug it.", source: "Brian Kernighan", length: "long" },
      { text: "There are two ways of constructing a software design: one way is to make it so simple that there are obviously no deficiencies, and the other way is to make it so complicated that there are no obvious deficiencies. The first method is far more difficult.", source: "C. A. R. Hoare", length: "long" }
    ],

    /* Keyboard geometry for the per-key heatmap. */
    rows: [ "qwertyuiop", "asdfghjkl", "zxcvbnm" ]
  };
});
