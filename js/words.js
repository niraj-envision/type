/* Word lists and quotes. Kept in one file so the test can be reseeded
   without touching the engine. */
window.WORDS = {
  /* The English 400 — ordered roughly by frequency, which is what makes a
     typing test feel like typing rather than a spelling bee. */
  english: `the be of and a to in he have it that for they i with as not on she at by this we
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
special talk particular today measure walk teach low hour type carry rate remain full street easy though
long lot decide friend wait cover person song music paper table green summer answer minute quick brown
jump lazy dog quiet ready river stone table travel window winter yellow young zero heart happy strong
short bright dark clean clever gentle honest quiet simple sudden useful warm wide wild wise deep`
    .trim().split(/\s+/),

  /* Programmer's set — symbols and camelCase, for the people who type code. */
  code: `const let var function return if else for while class extends import export default async await
try catch throw new this null true false undefined typeof instanceof => === !== && || ?? ?. ... {} [] ()
map filter reduce forEach push pop slice splice length concat join split index key value props state
render useState useEffect fetch then catch resolve reject promise console.log require module exports
def self lambda yield with open print len range list dict set tuple str int float bool None True False
git commit push pull merge rebase branch checkout stash diff log status remote origin main HEAD
npm node python bash sudo mkdir chmod grep sed awk curl ssh docker compose build run exec volume`
    .trim().split(/\s+/),

  punctuation: [',', '.', '.', '.', ';', ':', '!', '?', "'", '-'],

  quotes: [
    { text: "The quick brown fox jumps over the lazy dog.", source: "pangram", length: "short" },
    { text: "Simplicity is the ultimate sophistication.", source: "Leonardo da Vinci", length: "short" },
    { text: "Talk is cheap. Show me the code.", source: "Linus Torvalds", length: "short" },
    { text: "Any sufficiently advanced technology is indistinguishable from magic.", source: "Arthur C. Clarke", length: "short" },
    { text: "The only way to do great work is to love what you do.", source: "Steve Jobs", length: "short" },
    { text: "Premature optimization is the root of all evil.", source: "Donald Knuth", length: "short" },
    { text: "It is not enough for code to work. It must also be easy to read and understand, because you will spend far more time reading it than writing it.", source: "Robert C. Martin", length: "medium" },
    { text: "Programs must be written for people to read, and only incidentally for machines to execute. A programming language is low level when its programs require attention to the irrelevant.", source: "Abelson and Sussman", length: "medium" },
    { text: "The computer was born to solve problems that did not exist before. Every piece of software is a small argument about how the world should work, written in a language that cannot tolerate ambiguity.", source: "Bill Gates, adapted", length: "medium" },
    { text: "Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away. In anything at all, perfection is finally attained not when there is no longer anything to add, but when there is no longer anything to take away.", source: "Antoine de Saint-Exupery", length: "long" },
    { text: "We are stuck with technology when what we really want is just stuff that works. The best way to predict the future is to invent it, and the second best way is to write it down clearly enough that somebody else can build it. Most of the work of thinking is the work of writing, and most of the work of writing is the work of deleting.", source: "Douglas Adams and others", length: "long" },
    { text: "There are only two hard things in computer science: cache invalidation, naming things, and off-by-one errors. The first is hard because the world changes underneath you, the second because names are promises you have to keep, and the third because counting is the one thing everybody assumes they already know how to do.", source: "Phil Karlton, extended", length: "long" },
    { text: "A language that does not affect the way you think about programming is not worth knowing. Learning a new language should change the shape of the problems you notice, not just the syntax you type.", source: "Alan Perlis", length: "medium" },
    { text: "The best time to plant a tree was twenty years ago. The second best time is now.", source: "proverb", length: "short" },
    { text: "Speed is a byproduct of accuracy. Nobody ever typed faster by trying to type faster; they typed faster by making fewer mistakes and then, one day, noticing that the same care now took less time.", source: "on practice", length: "medium" }
  ],

  /* Keyboard geometry for the per-key heatmap. */
  rows: [ "qwertyuiop", "asdfghjkl", "zxcvbnm" ]
};
