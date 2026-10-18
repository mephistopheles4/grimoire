# chef-band (throwaway prototype)

A band above the prompt that tells the owner what a head chef session puts at risk, with an "I understand" button. The band is for awareness: the risk is too wide to reduce, so it asks for informed consent.

- `/chef-band` shows the band in the session that runs it.
- "I understand" stores the date and a hash of the band's wording in the mod's store, and hides the band.
- Any change to the wording changes the hash, and the band comes back with "The list changed since you acknowledged it on <date>".

Not shipped and not part of the grimoire plugin. To try it, load this folder as its own plugin, for example `claude --plugin-dir prototypes/chef-band`. It has its own plugin name, so it loads beside the synced grimoire plugin.

Check it with `claude plugin validate prototypes/chef-band` and `claude plugin test prototypes/chef-band`.
