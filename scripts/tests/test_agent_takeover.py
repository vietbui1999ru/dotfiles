"""Fixture-only tests for explicit same-worktree takeover; no provider calls."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parents[1] / "agent-session"

class Takeover(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.repo = self.home / "repo with spaces"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.email", "fixture@example.test")
        self.git("config", "user.name", "Fixture")
        (self.repo / "tracked").write_text("base")
        self.git("add", "tracked")
        self.git("commit", "-m", "base")
        self.wt = self.home / "feature checkout"
        self.git("worktree", "add", "-b", "feat/example", str(self.wt))
        self.stub = self.home / "pueue"
        self.stub.write_text("#!/usr/bin/env python3\nimport os\nprint(os.environ.get('FAKE_PUEUE', '{\"tasks\":{}}'))\n")
        self.stub.chmod(0o755)
        self.codex = self.home / "codex"
        self.codex.write_text('#!/usr/bin/env python3\nimport os,sys,json\nfrom pathlib import Path\nPath(os.environ["CAPTURE"]).write_text(json.dumps({"argv":sys.argv[1:],"cwd":os.getcwd()}))\nsys.exit(int(os.environ.get("CODEX_EXIT","0")))\n')
        self.codex.chmod(0o755)
        self.env = dict(os.environ, AGENT_HANDOFF_PUEUE=str(self.stub), AGENT_HANDOFF_CODEX=str(self.codex), CAPTURE=str(self.home / "capture"))
    def git(self,*args,cwd=None):
        return subprocess.run(["git",*args],cwd=cwd or self.repo,text=True,capture_output=True,check=True).stdout.strip()
    def cli(self,*args,input=None,ok=True):
        p=subprocess.run([sys.executable,str(CLI),*map(str,args)],text=True,input=input,capture_output=True,env=self.env)
        if ok: self.assertEqual(p.returncode,0,p.stderr)
        return p
    def checkpoint(self,summary=None,**kw):
        a=["handoff","--from","cc","--to","codex","--reason","usage-exhausted","--goal","Continue feature"]
        if summary is not None: a.append("--stdin")
        p=self.cli(*a,self.wt,input=summary,**kw)
        if p.returncode: return p
        return json.loads(p.stdout)["checkpoint"]
    def takeover(self,note,*args,**kw):
        return self.cli("takeover",note,"--harness","codex",*args,self.wt,**kw)
    def test_factual_recovery_and_same_worktree_launch(self):
        note=self.checkpoint()
        text=(self.repo/".agents/sessions"/note).read_text()
        self.assertIn("summary_missing",text)
        self.assertIn("feat/example",text)
        out=self.takeover(note,"--owner-released")
        capture=json.loads((self.home/"capture").read_text())
        self.assertEqual(capture["argv"][:2],["-C",str(self.wt)])
        self.assertNotIn("--worktree",capture["argv"])
        self.assertIn(note,capture["argv"][2])
        self.assertFalse(list((self.repo/".agents/sessions/claims").glob("*.json")))
    def test_dry_run_preserves_files_and_makes_no_claim(self):
        (self.wt/"tracked").write_text("staged")
        self.git("add","tracked",cwd=self.wt)
        (self.wt/"tracked").write_text("unstaged")
        (self.wt/"untracked").write_text("new")
        note=self.checkpoint("Summary supplied")
        before=self.git("status","--porcelain",cwd=self.wt)
        index=(self.repo/".agents/sessions/index.json").read_bytes()
        self.takeover(note,"--dry-run")
        self.assertEqual(before,self.git("status","--porcelain",cwd=self.wt))
        self.assertEqual(index,(self.repo/".agents/sessions/index.json").read_bytes())
        self.assertFalse((self.repo/".agents/sessions/claims").exists())
        self.assertFalse((self.home/"capture").exists())
    def test_manual_claim_conflict_release_and_return(self):
        note=self.checkpoint("checkpoint")
        result=json.loads(self.takeover(note,"--owner-released","--prepare-only").stdout)
        token=result["claim_token"]
        self.assertNotEqual(self.takeover(note,"--owner-released",ok=False).returncode,0)
        bad=self.cli("release","wrong","--owner-released",self.wt,ok=False)
        self.assertNotEqual(bad.returncode,0)
        returned=self.cli("handoff","--from","codex","--to","cc","--reason","return","--parent-checkpoint",note,"--stdin",self.wt,input="Done and next steps")
        body=(self.repo/".agents/sessions"/json.loads(returned.stdout)["checkpoint"]).read_text()
        self.assertIn(note,body)
        self.cli("release",token,"--owner-released",self.wt)
        self.takeover(note,"--dry-run")
    def test_live_pueue_writer_refused(self):
        note=self.checkpoint()
        self.env["FAKE_PUEUE"]=json.dumps({"tasks":{"1":{"path":str(self.wt),"status":{"Running":{}}}}})
        self.assertNotEqual(self.takeover(note,"--owner-released",ok=False).returncode,0)
        self.assertFalse((self.home/"capture").exists())
    def test_legacy_identity_and_path_escape_refused(self):
        note=self.checkpoint()
        p=self.repo/".agents/sessions"/note
        text=p.read_text()
        p.write_text("\n".join(l for l in text.split("\n") if not l.startswith("worktree:")))
        self.assertNotEqual(self.takeover(note,"--dry-run",ok=False).returncode,0)
        self.assertNotEqual(self.takeover("../index.json","--dry-run",ok=False).returncode,0)
    def test_missing_owner_release_and_launch_failure_cleanup(self):
        note=self.checkpoint()
        self.assertNotEqual(self.takeover(note,ok=False).returncode,0)
        self.env["CODEX_EXIT"]="7"
        self.assertEqual(self.takeover(note,"--owner-released",ok=False).returncode,7)
        self.takeover(note,"--dry-run")
    def test_branch_mismatch_refused_and_head_drift_reported(self):
        note=self.checkpoint()
        (self.wt/"tracked").write_text("new")
        self.git("add","tracked",cwd=self.wt); self.git("commit","-m","advance",cwd=self.wt)
        self.assertIn("head_changed",self.takeover(note,"--dry-run").stdout)
        self.git("switch","-c","feat/other",cwd=self.wt)
        self.assertNotEqual(self.takeover(note,"--dry-run",ok=False).returncode,0)
    def test_parallel_manual_takeovers_only_one_claim(self):
        note=self.checkpoint()
        argv=[sys.executable,str(CLI),"takeover",note,"--harness","codex","--owner-released","--prepare-only",str(self.wt)]
        jobs=[subprocess.Popen(argv,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=self.env) for _ in range(2)]
        results=[(job,job.communicate()) for job in jobs]
        self.assertEqual(sum(job.returncode==0 for job,_ in results),1)
        for job,(out,err) in results:
            if job.returncode==0:
                self.cli("release",json.loads(out)["claim_token"],"--owner-released",self.wt)
    def test_handoff_preserves_main_legacy_pointer(self):
        pointer=self.repo/".claude/session-state.md"
        pointer.parent.mkdir(); pointer.write_text("main session remains here")
        self.checkpoint("feature handoff")
        self.assertEqual(pointer.read_text(),"main session remains here")
    def test_nested_pueue_writer_refused(self):
        note=self.checkpoint()
        child=self.wt/"subdir"; child.mkdir()
        self.env["FAKE_PUEUE"]=json.dumps({"tasks":{"2":{"path":str(child),"status":{"Running":{}}}}})
        self.assertNotEqual(self.takeover(note,"--dry-run",ok=False).returncode,0)
    def test_return_rejects_non_outbound_parent(self):
        note=self.checkpoint()
        path=self.repo/".agents/sessions"/note
        path.write_text(path.read_text().replace('reason: "usage-exhausted"','reason: "return"'))
        result=self.cli("handoff","--from","codex","--to","cc","--reason","return","--parent-checkpoint",note,self.wt,ok=False)
        self.assertNotEqual(result.returncode,0)
    def test_empty_summary_and_quoted_goal_roundtrip(self):
        note=self.checkpoint("   ")
        text=(self.repo/".agents/sessions"/note).read_text()
        self.assertIn('summary_missing: "true"',text)
        self.takeover(note,"--dry-run")
    def test_pending_review_ignored_bytes_and_injection_preserved(self):
        (self.wt/".gitignore").write_text("ignored\n")
        (self.wt/"ignored").write_bytes(b"private bytes")
        review=self.wt/".pi/agent-review/pending/r.json"
        review.parent.mkdir(parents=True); review.write_text('{"runId":"r","endTree":"old"}')
        note=self.checkpoint("Text `touch /tmp/never` $(echo untrusted)")
        before=review.read_bytes()
        self.takeover(note,"--owner-released")
        self.assertEqual(review.read_bytes(),before)
        self.assertEqual((self.wt/"ignored").read_bytes(),b"private bytes")
        self.assertIn("pending",json.loads((self.home/"capture").read_text())["argv"][2])

if __name__=="__main__": unittest.main()
